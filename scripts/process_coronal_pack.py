#!/usr/bin/env python3
"""Build a compact, auditable working layer from a verified coronal FITS pack.

The raw FITS files remain the source of truth. This script runs the deterministic
event diagnostics, writes one event-level feature row per target window, assigns
splits by active region (never by frame), and records the measured storage ratio.
It deliberately does not create heating-mechanism labels or train a mechanism
classifier because the observation pack contains no such ground truth.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.feature_selection import SelectKBest, VarianceThreshold, f_classif
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


ANALYSIS_VERSION = "analysis-v4"
FEATURE_VERSION = "event-features-v4"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def split_for_case(case: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    role = str(case.get("role") or "")
    if role in {"discovery", "holdout"}:
        return role
    linked = next(
        (item for item in cases if item.get("caseId") == case.get("backgroundFor")),
        None,
    )
    if linked and linked.get("role") in {"discovery", "holdout"}:
        return str(linked["role"])
    return "validation"


def analysis_cases(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep controls as independent event-level rows; never split image frames."""
    return list(cases)


def flatten_numeric(prefix: str, value: Any, output: dict[str, int | float]) -> None:
    if isinstance(value, bool):
        output[prefix] = int(value)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        output[prefix] = value
    elif isinstance(value, dict):
        for key, nested in value.items():
            if key in {"values", "timesSeconds", "epochSeconds", "sampleIds"}:
                continue
            flatten_numeric(f"{prefix}.{key}" if prefix else str(key), nested, output)


def event_feature_row(
    manifest: dict[str, Any], case: dict[str, Any], metrics: dict[str, Any]
) -> dict[str, Any]:
    numeric: dict[str, int | float] = {}
    flatten_numeric("diagnostic", metrics.get("diagnostics", {}), numeric)
    for channel_name, channel in metrics.get("target", {}).get("channels", {}).items():
        compact = "".join(character if character.isalnum() else "_" for character in channel_name)
        for field in (
            "count",
            "cadenceSeconds",
            "relativeVariability",
            "linearSlopePerHour",
            "peakCount",
            "dominantPeriodSeconds",
            "spectralSnr",
        ):
            value = channel.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                numeric[f"channel.{compact}.{field}"] = value
    return {
        "dataset_id": manifest.get("datasetId"),
        "case_id": case.get("caseId"),
        "active_region": case.get("activeRegion"),
        "event_role": case.get("role", "unassigned"),
        "analysis_split": split_for_case(case, manifest["cases"]),
        "mechanism_label": None,
        "feature_extractor_version": metrics.get("analysisDesign", {}).get(
            "featureExtractorVersion"
        ),
        "scientific_result_fingerprint": metrics.get("analysisDesign", {}).get(
            "scientificResultFingerprint"
        ),
        **numeric,
    }


def require_verified(
    manifest: dict[str, Any], required_asset_ids: set[str] | None = None
) -> None:
    incomplete = [
        asset.get("assetId")
        for asset in manifest.get("assets", [])
        if required_asset_ids is None or asset.get("assetId") in required_asset_ids
        if asset.get("downloadStatus") != "verified" or not asset.get("sha256")
    ]
    if incomplete:
        raise SystemExit(
            f"pack is incomplete: {len(incomplete)} assets are not verified; "
            "resume the downloader before processing"
        )


def require_hmi_metadata(manifest: dict[str, Any], dataset_root: Path) -> None:
    supplement = next(
        (
            item
            for item in manifest.get("metadataSupplements", [])
            if item.get("kind") == "jsoc-hmi-record-metadata"
        ),
        None,
    )
    if not supplement or not supplement.get("complete"):
        raise SystemExit(
            "verified HMI JSOC metadata sidecar is required; run scripts/enrich_hmi_metadata.py"
        )
    path = dataset_root / str(supplement.get("relativePath", ""))
    if not path.is_file() or sha256(path).lower() != str(supplement.get("sha256", "")).lower():
        raise SystemExit("HMI metadata sidecar is missing or failed SHA-256 verification")


def require_data_supplements(manifest: dict[str, Any], dataset_root: Path) -> None:
    """Reject incomplete or silently replaced evidence supplements before batch analysis."""
    for reference in manifest.get("dataSupplements", []):
        if not reference.get("complete"):
            raise SystemExit(f"data supplement is incomplete: {reference.get('kind')}")
        path = dataset_root / str(reference.get("relativePath", ""))
        if not path.is_file() or sha256(path).lower() != str(reference.get("sha256", "")).lower():
            raise SystemExit(
                f"data supplement manifest is missing or failed SHA-256 verification: "
                f"{reference.get('kind')}"
            )
        supplement = json.loads(path.read_text(encoding="utf-8"))
        verified_assets = [
            asset
            for asset in supplement.get("assets", [])
            if asset.get("downloadStatus") == "verified" and asset.get("sha256")
        ]
        expected_count = int(reference.get("assetCount", 0))
        expected_bytes = int(reference.get("bytes", 0))
        if (
            not supplement.get("complete")
            or len(verified_assets) != expected_count
            or sum(int(asset.get("bytes", 0)) for asset in verified_assets) != expected_bytes
        ):
            raise SystemExit(
                f"data supplement count/byte audit failed: {reference.get('kind')}"
            )


def write_feature_tables(rows: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    jsonl_path = output_dir / f"{FEATURE_VERSION}.jsonl"
    csv_path = output_dir / f"{FEATURE_VERSION}.csv"
    jsonl_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    columns = sorted({key for row in rows for key in row})
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    return jsonl_path, csv_path


def train_auxiliary_event_detector(rows: list[dict[str, Any]], output_dir: Path) -> dict[str, Any]:
    """Train a bounded event-vs-background pilot with active-region holdouts.

    The label is the collection design role, never a coronal-heating mechanism.
    Its output can prioritize review or flag anomalous windows, but is explicitly
    inadmissible as mechanism evidence.
    """
    report_path = output_dir / "auxiliary-event-detector-report.json"
    model_path = output_dir / "auxiliary-event-detector.joblib"
    labels = np.asarray(
        [0 if row.get("event_role") == "background_control" else 1 for row in rows],
        dtype=int,
    )
    groups = np.asarray([str(row.get("active_region")) for row in rows])
    excluded = {
        "dataset_id",
        "case_id",
        "active_region",
        "event_role",
        "analysis_split",
        "mechanism_label",
        "feature_extractor_version",
        "scientific_result_fingerprint",
    }
    feature_names = sorted(
        key
        for key in {key for row in rows for key in row}
        if key not in excluded
        and "background" not in key.lower()
        and "baseline" not in key.lower()
        and "aia_burst" not in key.lower()
        and not any(
            token in key.lower()
            for token in (
                "framecount",
                "recordcount",
                "timesamplecount",
                "usablebandcount",
                "cadenceseconds",
            )
        )
        and all(
            row.get(key) is None
            or isinstance(row.get(key), (int, float))
            and not isinstance(row.get(key), bool)
            for row in rows
        )
    )
    if len(rows) < 8 or len(np.unique(groups)) < 4 or len(np.unique(labels)) < 2:
        report = {
            "status": "not_trainable",
            "reason": "requires at least 8 event windows, 4 active regions and both role classes",
            "eventCount": len(rows),
            "activeRegionCount": int(len(np.unique(groups))),
            "mechanismEvidencePermitted": False,
            "permittedUse": ["window_ranking", "quality_inspection"],
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {**report, "reportPath": str(report_path.relative_to(output_dir.parent.parent))}

    matrix = np.asarray(
        [[float(row.get(name, np.nan)) for name in feature_names] for row in rows], dtype=float
    )
    finite_counts = np.sum(np.isfinite(matrix), axis=0)
    finite_variance = np.asarray(
        [np.nanstd(matrix[:, index]) for index in range(matrix.shape[1])], dtype=float
    )
    keep = (finite_counts >= max(4, len(rows) // 2)) & (finite_variance > 0)
    matrix = matrix[:, keep]
    feature_names = [name for name, selected in zip(feature_names, keep, strict=True) if selected]
    logo = LeaveOneGroupOut()
    selected_feature_count = min(8, matrix.shape[1])

    def make_pipeline() -> Pipeline:
        return Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
                # Fit the variance filter inside each active-region fold. A feature
                # may vary globally yet be constant after one region is held out.
                ("variance", VarianceThreshold(threshold=0.0)),
                ("scaler", StandardScaler()),
                ("selector", SelectKBest(score_func=f_classif, k=selected_feature_count)),
                (
                    "classifier",
                    LogisticRegression(
                        C=0.1,
                        class_weight="balanced",
                        max_iter=2000,
                        random_state=0,
                    ),
                ),
            ]
        )

    def cross_validated_probabilities(candidate_labels: np.ndarray) -> tuple[np.ndarray, list[str], list[str]]:
        probabilities = np.full(len(rows), np.nan, dtype=float)
        evaluated_groups: list[str] = []
        skipped_groups: list[str] = []
        for train, test in logo.split(matrix, candidate_labels, groups):
            held_out = sorted(set(groups[test].tolist()))
            if len(np.unique(candidate_labels[train])) < 2:
                skipped_groups.extend(held_out)
                continue
            fold_pipeline = make_pipeline()
            fold_pipeline.fit(matrix[train], candidate_labels[train])
            probabilities[test] = fold_pipeline.predict_proba(matrix[test])[:, 1]
            evaluated_groups.extend(held_out)
        return probabilities, evaluated_groups, skipped_groups

    probabilities, evaluated_groups, skipped_groups = cross_validated_probabilities(labels)
    evaluated = np.isfinite(probabilities)
    auc = (
        float(roc_auc_score(labels[evaluated], probabilities[evaluated]))
        if evaluated.sum() >= 4 and len(np.unique(labels[evaluated])) == 2
        else None
    )
    balanced_accuracy = (
        float(balanced_accuracy_score(labels[evaluated], probabilities[evaluated] >= 0.5))
        if evaluated.sum() >= 4 and len(np.unique(labels[evaluated])) == 2
        else None
    )
    mixed_groups = [
        group
        for group in sorted(set(groups.tolist()))
        if len(np.unique(labels[groups == group])) == 2
    ]
    permutation_aucs: list[float] = []
    if auc is not None and len(mixed_groups) <= 10:
        for switches in itertools.product((False, True), repeat=len(mixed_groups)):
            permuted = labels.copy()
            for group, switch in zip(mixed_groups, switches, strict=True):
                if switch:
                    indices = groups == group
                    permuted[indices] = 1 - permuted[indices]
            permuted_probabilities, _, _ = cross_validated_probabilities(permuted)
            valid = np.isfinite(permuted_probabilities)
            if valid.sum() >= 4 and len(np.unique(permuted[valid])) == 2:
                permutation_aucs.append(
                    float(roc_auc_score(permuted[valid], permuted_probabilities[valid]))
                )
    permutation_p_value = (
        float(sum(value >= auc for value in permutation_aucs) / len(permutation_aucs))
        if auc is not None and permutation_aucs
        else None
    )

    pipeline = make_pipeline()
    pipeline.fit(matrix, labels)
    joblib.dump(
        {
            "pipeline": pipeline,
            "featureNames": feature_names,
            "featureExtractorVersion": FEATURE_VERSION,
            "target": "event_window_vs_background_control",
            "mechanismEvidencePermitted": False,
            "permittedUse": ["window_ranking", "quality_inspection"],
        },
        model_path,
        compress=3,
    )
    variance_mask = pipeline.named_steps["variance"].get_support()
    varying_names = [
        name for name, selected in zip(feature_names, variance_mask, strict=True) if selected
    ]
    selected_mask = pipeline.named_steps["selector"].get_support()
    selected_names = [
        name for name, selected in zip(varying_names, selected_mask, strict=True) if selected
    ]
    coefficients = pipeline.named_steps["classifier"].coef_[0]
    ranked = sorted(
        zip(selected_names, coefficients, strict=True),
        key=lambda item: abs(float(item[1])),
        reverse=True,
    )[:12]
    predictions = [
        {
            "caseId": row.get("case_id"),
            "activeRegion": row.get("active_region"),
            "observedRole": row.get("event_role"),
            "leaveOneRegionOutEventScore": (
                float(probabilities[index]) if np.isfinite(probabilities[index]) else None
            ),
        }
        for index, row in enumerate(rows)
    ]
    report = {
        "status": "pilot_only",
        "target": "event window versus registered background-control window",
        "eventCount": len(rows),
        "activeRegionCount": int(len(np.unique(groups))),
        "featureCount": len(feature_names),
        "eligibleFeatureCount": len(feature_names),
        "selectedFeaturesPerFold": selected_feature_count,
        "featureSelectionPolicy": (
            "median imputation, zero-variance removal and SelectKBest are fitted "
            "inside each training fold"
        ),
        "leakageExclusions": [
            "background/baseline comparison features",
            "burst-stream presence",
            "frame/record/sample counts and cadence",
        ],
        "splitPolicy": "leave one active region out; no frame-level random split",
        "evaluatedActiveRegions": sorted(set(evaluated_groups)),
        "skippedActiveRegions": sorted(set(skipped_groups)),
        "outOfGroupRocAuc": auc,
        "outOfGroupBalancedAccuracyAt0_5": balanced_accuracy,
        "pairedGroupExactPermutationCount": len(permutation_aucs),
        "pairedGroupPermutationPValueRocAuc": permutation_p_value,
        "statisticallyResolvedAt0_05": bool(
            permutation_p_value is not None and permutation_p_value <= 0.05
        ),
        "scoreCalibration": "uncalibrated; too few independent active regions for probability calibration",
        "topStandardizedCoefficients": [
            {"feature": name, "coefficient": float(value)} for name, value in ranked
        ],
        "predictions": predictions,
        "modelPath": str(model_path.relative_to(output_dir.parent.parent)).replace("\\", "/"),
        "mechanismEvidencePermitted": False,
        "permittedUse": ["window_ranking", "quality_inspection"],
        "boundary": (
            "This model detects collection-role differences only. It has no adjudicated heating-mechanism "
            "labels and must never create support/contradict evidence or a mechanism confidence."
        ),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        **report,
        "reportPath": str(report_path.relative_to(output_dir.parent.parent)).replace("\\", "/"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--case-id", action="append", default=[])
    parser.add_argument("--skip-analysis", action="store_true")
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    dataset_root = args.dataset_root.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output_dir = dataset_root / "derived" / ANALYSIS_VERSION
    output_dir.mkdir(parents=True, exist_ok=True)
    targets = analysis_cases(manifest["cases"])
    if args.case_id:
        selected = set(args.case_id)
        targets = [case for case in targets if case.get("caseId") in selected]
        missing = selected - {str(case.get("caseId")) for case in targets}
        if missing:
            raise SystemExit(f"unknown case ids: {', '.join(sorted(missing))}")
    required_asset_ids: set[str] | None = None
    if args.case_id:
        target_ids = {str(case["caseId"]) for case in targets}
        required_case_ids = set(target_ids)
        for case in manifest["cases"]:
            if case.get("backgroundFor") in target_ids or (
                case.get("role") == "background_control"
                and any(case.get("activeRegion") == target.get("activeRegion") for target in targets)
            ):
                required_case_ids.add(str(case["caseId"]))
        required_asset_ids = {
            str(observation["assetId"])
            for case in manifest["cases"]
            if case.get("caseId") in required_case_ids
            for observation in case.get("observations", [])
        }
    require_verified(manifest, required_asset_ids)
    require_hmi_metadata(manifest, dataset_root)
    require_data_supplements(manifest, dataset_root)

    analyzer = Path(__file__).with_name("analyze_coronal_window.py")
    rows: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    diagnostic_status_counts: dict[str, dict[str, int]] = {}
    for index, case in enumerate(targets, start=1):
        case_id = str(case["caseId"])
        mode = split_for_case(case, manifest["cases"])
        print(f"analysis {index}/{len(targets)}: {case_id} ({mode})", flush=True)
        case_output = output_dir / case_id
        metrics_path = case_output / "coronal_metrics.json"
        figure_path = case_output / "coronal_diagnostics.png"
        if not args.skip_analysis:
            case_output.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [
                    sys.executable,
                    str(analyzer),
                    "--manifest",
                    str(manifest_path),
                    "--dataset-root",
                    str(dataset_root),
                    "--case-id",
                    case_id,
                    "--output-dir",
                    str(case_output),
                    "--mode",
                    mode,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        if not metrics_path.is_file() or not figure_path.is_file():
            raise SystemExit(f"analysis artifacts missing for {case_id}")
        metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        for diagnostic_name, diagnostic in metrics.get("diagnostics", {}).items():
            status = (
                str(diagnostic.get("observableStatus", "missing"))
                if isinstance(diagnostic, dict)
                else "missing"
            )
            counts = diagnostic_status_counts.setdefault(str(diagnostic_name), {})
            counts[status] = counts.get(status, 0) + 1
        rows.append(event_feature_row(manifest, case, metrics))
        artifacts.append(
            {
                "caseId": case_id,
                "analysisSplit": mode,
                "metricsPath": str(metrics_path.relative_to(dataset_root)).replace("\\", "/"),
                "metricsSha256": sha256(metrics_path),
                "figurePath": str(figure_path.relative_to(dataset_root)).replace("\\", "/"),
                "figureSha256": sha256(figure_path),
            }
        )

    jsonl_path, csv_path = write_feature_tables(rows, output_dir)
    auxiliary_model = train_auxiliary_event_detector(rows, output_dir)
    primary_raw_bytes = int(
        manifest.get("plannedTotalBytes")
        or sum(int(asset.get("bytes", 0)) for asset in manifest.get("assets", []))
    )
    supplemental_raw_bytes = int(manifest.get("supplementalBytes") or 0)
    raw_bytes = int(
        manifest.get("totalBytesIncludingSupplements")
        or primary_raw_bytes + supplemental_raw_bytes
    )
    cache_dir = dataset_root / "derived" / "wcs-roi-dem-v3"
    cache_bytes = directory_bytes(cache_dir)
    active_regions = sorted({str(row["active_region"]) for row in rows})
    holdout_case_count = sum(artifact["analysisSplit"] == "holdout" for artifact in artifacts)

    def support_count(diagnostic_name: str) -> int:
        return diagnostic_status_counts.get(diagnostic_name, {}).get("support", 0)

    bounded_process_ready = (
        len(active_regions) >= 3
        and holdout_case_count >= 1
        and support_count("dem_temperature") >= 3
        and (
            support_count("cooling_sequence") >= 2
            or support_count("event_fluence_distribution") >= 3
        )
    )
    targeted_reference = next(
        (
            item
            for item in manifest.get("dataSupplements", [])
            if item.get("kind") == "targeted-discriminants-hxr-spectroscopy-v1"
            and item.get("complete")
        ),
        None,
    )
    targeted_manifest: dict[str, Any] = {}
    if targeted_reference:
        targeted_path = dataset_root / str(targeted_reference.get("relativePath", ""))
        if targeted_path.is_file():
            targeted_manifest = json.loads(targeted_path.read_text(encoding="utf-8"))
    targeted_assets = targeted_manifest.get("assets", [])
    has_verified_nustar_inputs = any(
        asset.get("instrument") == "NuSTAR"
        and asset.get("role") == "calibrated-event-list"
        and asset.get("downloadStatus") == "verified"
        for asset in targeted_assets
    )
    has_verified_eis_level1 = any(
        asset.get("instrument") == "Hinode/EIS"
        and asset.get("productLevel") == "level1-hdf5"
        and asset.get("downloadStatus") == "verified"
        for asset in targeted_assets
    )
    has_versioned_eis_analysis = any(
        product.get("kind") in ("eis-versioned-line-fitting-v1", "eis-versioned-line-fitting-v2")
        and not product.get("mechanismEvidencePermitted", True)
        and (dataset_root / str(product.get("relativePath", ""))).is_file()
        and sha256(dataset_root / str(product.get("relativePath", ""))).lower()
        == str(product.get("sha256", "")).lower()
        for product in targeted_manifest.get("analysisProducts", [])
    )
    has_nustar_quality_audit = any(
        product.get("kind") in ("nustar-hxr-quality-v1", "nustar-hxr-solar-geometry-v2")
        and not product.get("mechanismEvidencePermitted", True)
        and (dataset_root / str(product.get("relativePath", ""))).is_file()
        and sha256(dataset_root / str(product.get("relativePath", ""))).lower()
        == str(product.get("sha256", "")).lower()
        for product in targeted_manifest.get("analysisProducts", [])
    )
    has_nustar_count_rate_chain = any(
        product.get("kind") == "nustar-hxr-solar-geometry-v2"
        and not product.get("mechanismEvidencePermitted", True)
        and (dataset_root / str(product.get("relativePath", ""))).is_file()
        and sha256(dataset_root / str(product.get("relativePath", ""))).lower()
        == str(product.get("sha256", "")).lower()
        for product in targeted_manifest.get("analysisProducts", [])
    )
    has_iris_method_replication = any(
        product.get("kind") == "iris-method-replication-v1"
        and not product.get("mechanismEvidencePermitted", True)
        and (dataset_root / str(product.get("relativePath", ""))).is_file()
        and sha256(dataset_root / str(product.get("relativePath", ""))).lower()
        == str(product.get("sha256", "")).lower()
        for product in targeted_manifest.get("analysisProducts", [])
    )
    claim_readiness = {
        "boundedThermalProcess": {
            "status": "sufficient_for_bounded_claim" if bounded_process_ready else "insufficient",
            "localDataSufficient": bounded_process_ready,
            "boundary": (
                "May support a pre-registered cross-event thermal-process claim; "
                "does not identify a unique microscopic heating mechanism."
            ),
        },
        "specificWaveHeating": {
            "status": "requires_targeted_data",
            "localDataSufficient": False,
            "missing": [
                "at least three independent, manually audited loop paths",
                "density, phase speed, amplitude and damping length",
                "wave-energy flux versus radiative and conductive losses",
            ],
        },
        "specificReconnectionOrNanoflare": {
            "status": (
                "requires_physical_hxr_extraction"
                if has_nustar_quality_audit
                else "requires_calibrated_analysis"
                if has_verified_nustar_inputs
                else "requires_targeted_data"
            ),
            "localDataSufficient": False,
            "missing": [
                (
                    "NuSTAR response-matrix spectral fit (CALDB) for a physical hard-X-ray "
                    "flux interval or upper limit, and roll-referenced solar coordinate "
                    "mapping (2014-era event headers lack the binary-table WCS keywords)"
                    if has_nustar_count_rate_chain
                    else "NuSTAR solar source/background extraction, response/ghost-ray audit and a physical hard-X-ray flux interval or upper limit"
                    if has_nustar_quality_audit
                    else "NuSTAR livetime/source/background/response/ghost-ray analysis and a physical hard-X-ray interval or upper limit"
                    if has_verified_nustar_inputs
                    else "event-matched hard-X-ray or non-thermal constraints"
                ),
                "replicated magnetic-thermal association",
                "magnetic topology/free-energy forward modelling",
            ],
        },
        "spectroscopicConstraints": {
            "status": (
                "requires_independent_replication"
                if has_versioned_eis_analysis
                else (
                    "requires_versioned_line_fitting"
                    if has_verified_eis_level1
                    else "requires_targeted_data"
                )
            ),
            "localDataSufficient": False,
            "missing": [
                (
                    "independent replication of the frozen CHIANTI density and non-thermal "
                    "width conversions across a third spectroscopic event"
                    if has_versioned_eis_analysis
                    else (
                        "versioned EIS line fitting with propagated intensity, relative-Doppler, width and density-ratio uncertainty"
                        if has_verified_eis_level1
                        else "calibrated EIS level-1 spectra"
                    )
                ),
                "at least three independent spectroscopy event groups for mechanism-level replication",
            ],
            "processedPositiveControlEvents": (
                ["ar11899-joint-spectroscopy-20131119"]
                + (["ar11890-nanoflare-footpoints-20131109"] if has_iris_method_replication else [])
            ),
        },
        "coupledMechanism": {
            "status": "requires_targeted_data",
            "localDataSufficient": False,
            "missing": [
                "observation-matched MHD forward models",
                "component ablation and independent predictive gain",
            ],
        },
    }
    report = {
        "schemaVersion": 1,
        "datasetId": manifest.get("datasetId"),
        "manifestPath": str(manifest_path),
        "manifestSha256": sha256(manifest_path),
        "rawBytes": raw_bytes,
        "primaryRawBytes": primary_raw_bytes,
        "supplementalRawBytes": supplemental_raw_bytes,
        "dataSupplements": manifest.get("dataSupplements", []),
        "workingCacheBytes": cache_bytes,
        "workingCacheToRawRatio": cache_bytes / raw_bytes if raw_bytes else None,
        "lossyWorkingLayer": True,
        "rawRetentionRequired": True,
        "processedCaseCount": len(rows),
        "processedTargetCount": sum(
            row.get("event_role") != "background_control" for row in rows
        ),
        "processedBackgroundControlCount": sum(
            row.get("event_role") == "background_control" for row in rows
        ),
        "independentActiveRegionCount": len(active_regions),
        "independentActiveRegions": active_regions,
        "holdoutCaseCount": holdout_case_count,
        "diagnosticCoverage": diagnostic_status_counts,
        "claimReadiness": claim_readiness,
        "dataSufficiencyConclusion": {
            "competitionWorkflow": "sufficient",
            "boundedProcessInference": (
                "sufficient" if bounded_process_ready else "insufficient"
            ),
            "allSpecificMechanisms": "insufficient",
            "requiresMoreSameTypeAia": False,
            "requiresTargetedNewEvidenceDimensions": True,
        },
        "featureJsonl": str(jsonl_path.relative_to(dataset_root)).replace("\\", "/"),
        "featureCsv": str(csv_path.relative_to(dataset_root)).replace("\\", "/"),
        "mechanismLabelsPresent": False,
        "mlReadiness": {
            "mechanismClassifier": "not_permitted_without independently adjudicated mechanism labels",
            "eventOrBackgroundDetector": (
                "pilot_only" if len(active_regions) < 10 else "eligible_for_grouped_evaluation"
            ),
            "changePointAndAnomalyDetection": "eligible",
            "requiredSplitPolicy": "group by active region/event; never randomize frames across splits",
        },
        "auxiliaryEventDetector": auxiliary_model,
        "artifacts": artifacts,
    }
    report_path = output_dir / "processing_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), **report}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
