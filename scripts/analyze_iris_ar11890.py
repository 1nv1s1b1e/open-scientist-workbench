#!/usr/bin/env python3
"""Bounded IRIS Level-2 method replication for the registered AR 11890 event.

Testa, De Pontieu & Allred (2014, Science, 346, 315) observed AR 11890 with
IRIS on 2013-11-09 and reported redshifted Si IV transition-region flows in
small footpoint brightenings; the registered observation
20131109_120415_3860257403 is that campaign. This script runs the same
frozen method as the AR 11899 holdout (O I 1355.5988-calibrated Si IV
1393.755 centroid velocities) over the full raster without any
outcome-selected region:

* the bright-footpoint statistic uses the same pre-frozen intensity
  percentile rule as the AR 11899 sensitivity comparison (bright = Si IV
  intensity at or above the 85th percentile, reference = 40th-60th);
* replication is reported at the method level only. A positive redshift
  here is consistent with the published positive control but does not
  identify a heating mechanism and cannot be transferred to other events.

The product registers as `iris-method-replication-v1` in the
targeted-discriminants supplement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits

from analyze_joint_spectroscopy import (
    line_moments,
    wavelength_axis,
    window_index,
)


SPEED_OF_LIGHT_KM_S = 299792.458
# The registered observation (IRIS study of obsid 3860257403) carries the
# Si IV 1403 spectral window instead of Si IV 1394; both are the Si IV
# resonance doublet lines with the same formation temperature. The weaker
# 1402.773 line is used when 1394 is absent, with the window-matching rule
# below selecting whichever doublet member the raster actually contains.
SI_IV_WINDOWS = (
    ("Si IV 1394", 1393.755),
    ("Si IV 1403", 1402.773),
)
O_I_REST_A = 1355.5988
VERSION = "iris-method-replication-v1"
BRIGHT_PERCENTILE = 85.0
REFERENCE_LOWER_PERCENTILE = 40.0
REFERENCE_UPPER_PERCENTILE = 60.0
MIN_SI_IV_PIXELS = 100


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def bootstrap_interval(values: np.ndarray, repeats: int = 4000) -> list[float] | None:
    finite = np.asarray(values, dtype=float)
    finite = finite[np.isfinite(finite)]
    if finite.size < 4:
        return None
    seed = int.from_bytes(hashlib.sha256(finite.astype("<f8").tobytes()).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    medians = np.median(rng.choice(finite, size=(repeats, finite.size), replace=True), axis=1)
    return [float(np.percentile(medians, 2.5)), float(np.percentile(medians, 97.5))]


def raster_velocity(file_object: Any, member_name: str) -> dict[str, Any] | None:
    with fits.open(file_object, memmap=False, lazy_load_hdus=False) as hdul:
        primary = hdul[0].header
        si_selection = next(
            (
                (window_index(primary, pattern), rest, pattern)
                for pattern, rest in SI_IV_WINDOWS
                if window_index(primary, pattern) is not None
            ),
            None,
        )
        oi_index = window_index(primary, "O I 1356")
        if si_selection is None or oi_index is None:
            raise ValueError("required Si IV doublet or O I 1356 window is absent")
        si_index, si_iv_rest_a, si_window_name = si_selection
        si_cube = np.asarray(hdul[si_index].data, dtype=np.float32)
        oi_cube = np.asarray(hdul[oi_index].data, dtype=np.float32)
        if si_cube.ndim != 3 or oi_cube.ndim != 3:
            raise ValueError("IRIS Level-2 spectral windows must be three-dimensional")
        si_wave = wavelength_axis(hdul[si_index].header, primary, si_index, si_cube.shape[-1])
        oi_wave = wavelength_axis(hdul[oi_index].header, primary, oi_index, oi_cube.shape[-1])
        si_total, si_centroid, _ = line_moments(si_cube, si_wave, si_iv_rest_a, 0.45)
        oi_total, oi_centroid, _ = line_moments(oi_cube, oi_wave, O_I_REST_A, 0.12)
        oi_valid = np.isfinite(oi_centroid) & np.isfinite(oi_total) & (oi_total > 0)
        if int(np.count_nonzero(oi_valid)) < 100:
            raise ValueError("too few O I pixels for wavelength-drift calibration")
        oi_floor = np.nanpercentile(oi_total[oi_valid], 35)
        wavelength_offset = float(
            np.nanmedian(oi_centroid[oi_valid & (oi_total >= oi_floor)]) - O_I_REST_A
        )
        si_valid = np.isfinite(si_centroid) & np.isfinite(si_total) & (si_total > 0)
        if int(np.count_nonzero(si_valid)) < MIN_SI_IV_PIXELS:
            raise ValueError("too few Si IV pixels for a spatially resolved diagnostic")
        calibrated = si_centroid - wavelength_offset
        velocity = (calibrated - si_iv_rest_a) / si_iv_rest_a * SPEED_OF_LIGHT_KM_S
        bright_threshold = float(np.nanpercentile(si_total[si_valid], BRIGHT_PERCENTILE))
        reference_lower = float(np.nanpercentile(si_total[si_valid], REFERENCE_LOWER_PERCENTILE))
        reference_upper = float(np.nanpercentile(si_total[si_valid], REFERENCE_UPPER_PERCENTILE))
        bright = si_valid & (si_total >= bright_threshold)
        reference = si_valid & (si_total >= reference_lower) & (si_total <= reference_upper)
        bright_velocity = float(np.nanmedian(velocity[bright]))
        reference_velocity = float(np.nanmedian(velocity[reference]))
        return {
            "member": member_name,
            "observationDescription": str(primary.get("OBS_DESC", "")),
            "siIvWindow": si_window_name,
            "siIvRestWavelengthAngstrom": si_iv_rest_a,
            "rasterPositions": int(si_cube.shape[0]),
            "slitPixels": int(si_cube.shape[1]),
            "wavelengthOffsetFromOiAngstrom": wavelength_offset,
            "siIvValidPixelCount": int(np.count_nonzero(si_valid)),
            "brightPixelCount": int(np.count_nonzero(bright)),
            "referencePixelCount": int(np.count_nonzero(reference)),
            "brightSiIvVelocityKmPerSecond": bright_velocity,
            "referenceSiIvVelocityKmPerSecond": reference_velocity,
            "brightMinusReferenceVelocityKmPerSecond": bright_velocity - reference_velocity,
            "redshiftedPixelFraction": float(
                np.mean(velocity[si_valid] > 0.0)
            ),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--root-manifest", type=Path, required=True)
    args = parser.parse_args()
    dataset_root = args.dataset_root.resolve()
    supplement_path = dataset_root / "supplements/targeted-discriminants-v1/manifest.json"
    supplement = json.loads(supplement_path.read_text(encoding="utf-8"))
    raster_asset = next(
        (
            row
            for row in supplement.get("assets", [])
            if row.get("assetId") == "iris-ar11890-raster"
        ),
        None,
    )
    if raster_asset is None:
        raise SystemExit("iris-ar11890-raster is not registered in the supplement")
    raster_path = dataset_root / str(raster_asset["relativePath"])
    if sha256(raster_path) != raster_asset.get("sha256"):
        raise SystemExit("IRIS raster archive failed SHA-256 verification")

    rows: list[dict[str, Any]] = []
    failures: list[str] = []
    with tarfile.open(raster_path, "r:gz") as archive:
        members = [
            member
            for member in archive.getmembers()
            if member.isfile() and member.name.lower().endswith((".fits", ".fit"))
        ]
        for member in members:
            extracted = archive.extractfile(member)
            if extracted is None:
                failures.append(f"{member.name}: archive member cannot be opened")
                continue
            try:
                diagnostic = raster_velocity(extracted, member.name)
                if diagnostic is not None:
                    rows.append(diagnostic)
            except Exception as error:  # per-raster audit instead of hiding failures
                failures.append(f"{member.name}: {type(error).__name__}: {error}")

    differences = np.asarray(
        [float(row["brightMinusReferenceVelocityKmPerSecond"]) for row in rows], dtype=float
    )
    interval = bootstrap_interval(differences)
    median_difference = float(np.median(differences)) if differences.size else None
    replicated = bool(
        median_difference is not None
        and interval is not None
        and len(rows) >= 1
        and median_difference > 0.0
        and interval[0] > 0.0
    )
    quantitative = []
    if median_difference is not None and interval is not None:
        quantitative.append(
            {
                "metric": "iris_si_iv_bright_minus_reference_velocity",
                "estimate": median_difference,
                "lowerBound": interval[0],
                "upperBound": interval[1],
                "confidenceLevel": 0.95,
                "unit": "km/s",
            }
        )
    output = {
        "schemaVersion": 1,
        "analysisVersion": VERSION,
        "generatedAt": now(),
        "caseId": raster_asset.get("caseId"),
        "sourceManifestSha256": sha256(supplement_path),
        "sourceAssetId": raster_asset.get("assetId"),
        "sourceAssetSha256": raster_asset.get("sha256"),
        "methodProvenance": "analyze_joint_spectroscopy.py AR11899 frozen method (O I-calibrated Si IV 1393.755 centroid)",
        "publishedPositiveControl": {
            "reference": "Testa, De Pontieu & Allred 2014, Science, 346, 315",
            "doi": "10.1126/science.1249597",
            "observation": "IRIS raster 20131109_120415_3860257403 of AR 11890",
        },
        "frozenCriterion": (
            "the 95% raster-bootstrap interval of the median bright-minus-reference O "
            "I-calibrated Si IV velocity is entirely positive, with bright and reference "
            "pixels selected by the pre-frozen 85th and 40th-60th intensity percentile rule"
        ),
        "observableStatus": "support" if replicated else "unknown",
        "rasterCount": len(rows),
        "failedRasterCount": len(failures),
        "medianBrightMinusReferenceVelocityKmPerSecond": median_difference,
        "velocityInterval95KmPerSecond": interval,
        "quantitativeResults": quantitative,
        "rasters": rows,
        "failures": failures,
        "mechanismEvidencePermitted": False,
        "evidenceRole": "positive_control_method_replication",
        "boundaries": [
            "The registered raster carries the Si IV 1403 window (not 1394); the same "
            "method is applied to the 1402.773 doublet member, which shares the formation "
            "temperature but is about half as bright and can carry a small photospheric "
            "blend bias near the limb.",
            "No literature ROI is reproduced here; the bright and reference pixels follow the "
            "pre-frozen intensity percentile rule over the full raster, so this is a method "
            "replication and not a spatial re-analysis of the published footpoints.",
            "A positive redshift is consistent with the published transition-region flows but "
            "is not unique to nanoflare heating; mechanism discrimination requires an "
            "independent coronal thermal diagnostic.",
            "This second spectroscopic event does not by itself satisfy the three-independent-"
            "event replication gate and transfers no evidence to other events.",
        ],
    }
    output_path = dataset_root / "derived/iris-method-replication-v1/ar11890/iris_replication.json"
    write_json(output_path, output)
    product = {
        "kind": VERSION,
        "caseId": raster_asset.get("caseId"),
        "relativePath": output_path.relative_to(dataset_root).as_posix(),
        "sha256": sha256(output_path),
        "analysisVersion": VERSION,
        "inputAssetIds": [raster_asset.get("assetId")],
        "mechanismEvidencePermitted": False,
        "generatedAt": output["generatedAt"],
    }
    supplement["analysisProducts"] = [
        *[
            row
            for row in supplement.get("analysisProducts", [])
            if row.get("kind") != product["kind"]
        ],
        product,
    ]
    write_json(supplement_path, supplement)
    root_path = args.root_manifest.resolve()
    root_manifest = json.loads(root_path.read_text(encoding="utf-8"))
    for reference in root_manifest.get("dataSupplements", []):
        if reference.get("kind") == supplement.get("kind"):
            reference["sha256"] = sha256(supplement_path)
            reference["generatedAt"] = supplement["generatedAt"]
    write_json(root_path, root_manifest)
    print(json.dumps(product, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
