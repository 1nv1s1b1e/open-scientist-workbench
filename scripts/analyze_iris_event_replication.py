#!/usr/bin/env python3
"""Frozen-method IRIS replication for an additional independent event.

Applies the exact AR11899 frozen method — blend-excluding O I 1355.5988 Å
wavelength-drift calibration (±0.12 Å median centroid offset), Si IV
1393.755 Å line moments (±0.45 Å), and the pre-frozen 85th / 40th–60th
percentile bright/reference pixel selection — to a *new* event's IRIS
Level-2 raster archive, producing an `iris-method-replication-v2` product.

Differences from the AR11890 published-control replication:
- no literature-defined footpoint ROI exists for the new event, so the
  literature-ROI re-analysis is deliberately omitted and the percentile
  bright/reference statistic is the primary result;
- with a single raster the cross-raster bootstrap is impossible, so the 95%
  interval is a *pixel* bootstrap (resampling valid bright-reference pixels)
  and is labelled as such — the cross-raster interval stays null until more
  rasters exist.

The product is `mechanismEvidencePermitted: false` /
`evidenceRole: positive_control_method_replication`: it demonstrates that the
frozen method reproduces on an additional independent event; it never
constitutes mechanism evidence by itself.
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

SI_IV_REST_A = 1393.755
O_I_REST_A = 1355.5988
ANALYSIS_VERSION = "iris-method-replication-v2"
BOOTSTRAP_RESAMPLES = 1000
BOOTSTRAP_SEED = 20141211


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def window_index(primary_header: fits.Header, pattern: str) -> int | None:
    for index in range(1, int(primary_header.get("NWIN", 0)) + 1):
        if pattern.casefold() in str(primary_header.get(f"TDESC{index}", "")).casefold():
            return index
    return None


def wavelength_axis(header: fits.Header, primary: fits.Header, window: int, count: int) -> np.ndarray:
    crval = header.get("CRVAL1")
    cdelt = header.get("CDELT1")
    crpix = header.get("CRPIX1", 1.0)
    if crval is not None and cdelt is not None:
        return float(crval) + (np.arange(count, dtype=float) + 1.0 - float(crpix)) * float(cdelt)
    lower = primary.get(f"TWMIN{window}")
    upper = primary.get(f"TWMAX{window}")
    if lower is None or upper is None:
        raise ValueError(f"spectral window {window} has no wavelength WCS")
    return np.linspace(float(lower), float(upper), count, dtype=float)


def line_moments(
    cube: np.ndarray,
    wavelengths: np.ndarray,
    rest: float,
    half_width: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mask = np.abs(wavelengths - rest) <= half_width
    if int(np.count_nonzero(mask)) < 5:
        raise ValueError(f"line window near {rest:.4f} Å has fewer than five samples")
    values = np.asarray(cube[..., mask], dtype=np.float64)
    wave = wavelengths[mask]
    edge_count = max(1, min(3, values.shape[-1] // 4))
    continuum = np.nanmedian(
        np.concatenate([values[..., :edge_count], values[..., -edge_count:]], axis=-1),
        axis=-1,
        keepdims=True,
    )
    weights = np.clip(values - continuum, 0.0, None)
    total = np.nansum(weights, axis=-1)
    centroid = np.divide(
        np.nansum(weights * wave, axis=-1),
        total,
        out=np.full(total.shape, np.nan, dtype=float),
        where=total > 0,
    )
    variance = np.divide(
        np.nansum(weights * (wave - centroid[..., None]) ** 2, axis=-1),
        total,
        out=np.full(total.shape, np.nan, dtype=float),
        where=total > 0,
    )
    return total, centroid, np.sqrt(np.clip(variance, 0.0, None))


def pixel_bootstrap_interval(differences: np.ndarray, seed: int) -> list[float] | None:
    valid = differences[np.isfinite(differences)]
    if valid.size < 100:
        return None
    rng = np.random.default_rng(seed)
    medians = np.empty(BOOTSTRAP_RESAMPLES, dtype=float)
    for index in range(BOOTSTRAP_RESAMPLES):
        sample = rng.choice(valid, size=valid.size, replace=True)
        medians[index] = float(np.median(sample))
    return [float(np.percentile(medians, 2.5)), float(np.percentile(medians, 97.5))]


def raster_velocity(file_object: Any) -> dict[str, Any]:
    with fits.open(file_object, memmap=False, lazy_load_hdus=False) as hdul:
        primary = hdul[0].header
        si_index = window_index(primary, "Si IV 1394")
        oi_index = window_index(primary, "O I 1356")
        if si_index is None or oi_index is None:
            raise ValueError("required Si IV 1394 or O I 1356 window is absent")
        si_cube = np.asarray(hdul[si_index].data, dtype=np.float32)
        oi_cube = np.asarray(hdul[oi_index].data, dtype=np.float32)
        si_wave = wavelength_axis(hdul[si_index].header, primary, si_index, si_cube.shape[-1])
        oi_wave = wavelength_axis(hdul[oi_index].header, primary, oi_index, oi_cube.shape[-1])
        si_total, si_centroid, _ = line_moments(si_cube, si_wave, SI_IV_REST_A, 0.45)
        oi_total, oi_centroid, _ = line_moments(oi_cube, oi_wave, O_I_REST_A, 0.12)

        oi_valid = np.isfinite(oi_centroid) & np.isfinite(oi_total) & (oi_total > 0)
        if int(np.count_nonzero(oi_valid)) < 100:
            raise ValueError("too few O I pixels for wavelength-drift calibration")
        oi_floor = np.nanpercentile(oi_total[oi_valid], 35)
        calibration_pixels = oi_valid & (oi_total >= oi_floor)
        wavelength_offset = float(np.nanmedian(oi_centroid[calibration_pixels]) - O_I_REST_A)

        si_valid = np.isfinite(si_centroid) & np.isfinite(si_total) & (si_total > 0)
        if int(np.count_nonzero(si_valid)) < 100:
            raise ValueError("too few Si IV pixels for a spatially resolved diagnostic")

        corrected_velocity = (
            (si_centroid - wavelength_offset - SI_IV_REST_A) / SI_IV_REST_A * 299792.458
        )
        high_threshold = float(np.nanpercentile(si_total[si_valid], 85))
        reference_lower = float(np.nanpercentile(si_total[si_valid], 40))
        reference_upper = float(np.nanpercentile(si_total[si_valid], 60))
        bright = si_valid & (si_total >= high_threshold)
        reference = si_valid & (si_total >= reference_lower) & (si_total <= reference_upper)

        bright_velocity = float(np.nanmedian(corrected_velocity[bright]))
        reference_velocity = float(np.nanmedian(corrected_velocity[reference]))
        bright_minus_reference = corrected_velocity[bright][:, None] - corrected_velocity[reference][None, :]
        pixel_interval = pixel_bootstrap_interval(bright_minus_reference.ravel(), BOOTSTRAP_SEED)

        return {
            "member": "raster-step",
            "observationDescription": str(primary.get("OBS_DESC", "")),
            "rasterPositions": int(si_cube.shape[0]),
            "slitPixels": int(si_cube.shape[1]),
            "validSiIvPixelCount": int(np.count_nonzero(si_valid)),
            "brightPixelCount": int(np.count_nonzero(bright)),
            "referencePixelCount": int(np.count_nonzero(reference)),
            "wavelengthOffsetFromOiAngstrom": wavelength_offset,
            "brightSiIvVelocityKmPerSecond": bright_velocity,
            "referenceSiIvVelocityKmPerSecond": reference_velocity,
            "brightMinusReferenceVelocityKmPerSecond": bright_velocity - reference_velocity,
            "pixelBootstrapInterval95KmPerSecond": pixel_interval,
            "_pixel_differences": bright_minus_reference.ravel(),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supplement-manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    supplement = json.loads(args.supplement_manifest.resolve().read_text(encoding="utf-8"))
    dataset_root = args.dataset_root.resolve()
    raster_asset = next(
        asset for asset in supplement["assets"] if asset.get("assetId") == "iris-ar12222-raster"
    )
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
                rows.append(raster_velocity(extracted))
            except Exception as error:
                failures.append(f"{member.name}: {type(error).__name__}: {error}")

    # Pool all valid bright-reference pixel differences across raster steps,
    # then bootstrap once (single raster: pixels, not cross-raster resamples).
    pooled = (
        np.concatenate([row.pop("_pixel_differences") for row in rows])
        if rows
        else np.array([], dtype=float)
    )
    median_velocity = float(np.nanmedian(pooled)) if pooled.size else None
    interval = pixel_bootstrap_interval(pooled, BOOTSTRAP_SEED)

    quantitative = []
    if median_velocity is not None and interval is not None:
        quantitative.append(
            {
                "metric": "iris_ar12222_siiv_bright_minus_reference_velocity",
                "estimate": median_velocity,
                "lowerBound": interval[0],
                "upperBound": interval[1],
                "confidenceLevel": 0.95,
                "unit": "km/s",
            }
        )

    interval_object = (
        {
            "estimate": median_velocity,
            "lowerBound": interval[0],
            "upperBound": interval[1],
            "sampleCount": int(pooled.size),
        }
        if median_velocity is not None and interval is not None
        else None
    )

    result = {
        "schemaVersion": 2,
        "analysisVersion": ANALYSIS_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "caseId": args.case_id,
        "sourceManifestSha256": sha256(args.supplement_manifest.resolve()),
        "sourceAssetId": raster_asset.get("assetId"),
        "sourceAssetSha256": raster_asset.get("sha256"),
        "methodProvenance": (
            "analyze_iris_event_replication.py applying the AR11899 frozen method "
            "(O I 1355.5988 Å wavelength-drift calibration ±0.12 Å, Si IV 1393.755 Å "
            "centroid, pre-frozen 85th / 40th-60th percentile bright-reference rule)"
        ),
        "publishedPositiveControl": None,
        "frozenCriterion": (
            "single-raster event replication: the 95% pixel-bootstrap interval of the "
            "median O I-calibrated Si IV bright-minus-reference velocity is reported as "
            "an interval product; the cross-raster criterion (>=4 rasters) is not "
            "evaluable for one raster and stays honestly underpowered"
        ),
        "observableStatus": "unknown",
        "rasterCount": len(rows),
        "failedRasterCount": len(failures),
        "medianBrightMinusReferenceVelocityKmPerSecond": median_velocity,
        "velocityInterval95KmPerSecond": interval_object,
        "velocityIntervalBootstrapUnit": "pixels",
        "quantitativeResults": quantitative,
        "rasters": rows,
        "failures": failures,
        "mechanismEvidencePermitted": False,
        "evidenceRole": "positive_control_method_replication",
        "boundaries": [
            "Single raster (one event, one 4.3-minute sweep): the interval is a pixel "
            "bootstrap, not a cross-event interval; spatial context is not re-analysed "
            "against any published ROI because none exists for this event.",
            "The O I 1355.5988 Å calibration is relative (no absolute wavelength "
            "reference); velocities are relative to the per-step O I median centroid.",
            "Method replication demonstrates the frozen pipeline runs on an additional "
            "independent event; it does not by itself support any heating mechanism "
            "(mechanismEvidencePermitted=false).",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"product written: {args.output}")
    print(f"raster steps ok/failed: {len(rows)}/{len(failures)}")
    if median_velocity is not None and interval is not None:
        print(
            f"Si IV bright-reference velocity: {median_velocity:.3f} km/s "
            f"[{interval[0]:.3f}, {interval[1]:.3f}] (pixel bootstrap 95%)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
