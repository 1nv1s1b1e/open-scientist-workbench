#!/usr/bin/env python3
"""Run a bounded IRIS Level-2 spectroscopy audit for the frozen AR 11899 holdout."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import tarfile
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits


SPEED_OF_LIGHT_KM_S = 299792.458
SI_IV_REST_A = 1393.755
O_I_REST_A = 1355.5988
ANALYSIS_VERSION = "iris-spectroscopy-v4"
# Ghosh et al. (2017), Figure 5 region E: 5.6 x 17.84 arcsec.
# The bounds are frozen from the plotted helioprojective axes, not selected
# from the velocity outcome in this reanalysis.
FOOTPOINT_ROI_ARCSEC = {
    "hplnMin": 178.0,
    "hplnMax": 183.6,
    "hpltMin": 53.1,
    "hpltMax": 70.9,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def wavelength_axis(
    extension_header: fits.Header,
    primary_header: fits.Header,
    window_index: int,
    count: int,
) -> np.ndarray:
    crval = extension_header.get("CRVAL1")
    cdelt = extension_header.get("CDELT1")
    crpix = extension_header.get("CRPIX1", 1.0)
    if crval is not None and cdelt is not None:
        return float(crval) + (np.arange(count, dtype=float) + 1.0 - float(crpix)) * float(cdelt)
    lower = primary_header.get(f"TWMIN{window_index}")
    upper = primary_header.get(f"TWMAX{window_index}")
    if lower is None or upper is None:
        raise ValueError(f"spectral window {window_index} has no wavelength WCS")
    return np.linspace(float(lower), float(upper), count, dtype=float)


def window_index(primary_header: fits.Header, pattern: str) -> int | None:
    for index in range(1, int(primary_header.get("NWIN", 0)) + 1):
        if pattern.casefold() in str(primary_header.get(f"TDESC{index}", "")).casefold():
            return index
    return None


def helioprojective_coordinates(
    header: fits.Header, raster_positions: int, slit_pixels: int
) -> tuple[np.ndarray, np.ndarray]:
    required = ("CRPIX2", "CRVAL2", "CDELT2", "CRPIX3", "CRVAL3", "CDELT3")
    if any(header.get(key) is None for key in required):
        raise ValueError("IRIS raster has no complete helioprojective spatial WCS")
    slit_offset = np.arange(slit_pixels, dtype=float) + 1.0 - float(header["CRPIX2"])
    raster_offset = (
        np.arange(raster_positions, dtype=float) + 1.0 - float(header["CRPIX3"])
    )
    pc22 = float(header.get("PC2_2", 1.0))
    pc23 = float(header.get("PC2_3", 0.0))
    pc32 = float(header.get("PC3_2", 0.0))
    pc33 = float(header.get("PC3_3", 1.0))
    hplt = float(header["CRVAL2"]) + float(header["CDELT2"]) * (
        pc22 * slit_offset[None, :] + pc23 * raster_offset[:, None]
    )
    hpln = float(header["CRVAL3"]) + float(header["CDELT3"]) * (
        pc32 * slit_offset[None, :] + pc33 * raster_offset[:, None]
    )
    return hpln, hplt


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


def raster_diagnostic(file_object: Any, member_name: str) -> dict[str, Any]:
    with fits.open(file_object, memmap=False, lazy_load_hdus=False) as hdul:
        primary = hdul[0].header
        si_index = window_index(primary, "Si IV 1394")
        oi_index = window_index(primary, "O I 1356")
        if si_index is None or oi_index is None:
            raise ValueError("required Si IV 1394 or O I 1356 window is absent")
        si_cube = np.asarray(hdul[si_index].data, dtype=np.float32)
        oi_cube = np.asarray(hdul[oi_index].data, dtype=np.float32)
        if si_cube.ndim != 3 or oi_cube.ndim != 3:
            raise ValueError("IRIS Level-2 spectral windows must be three-dimensional")
        si_wave = wavelength_axis(hdul[si_index].header, primary, si_index, si_cube.shape[-1])
        oi_wave = wavelength_axis(hdul[oi_index].header, primary, oi_index, oi_cube.shape[-1])
        si_total, si_centroid, si_sigma = line_moments(si_cube, si_wave, SI_IV_REST_A, 0.45)
        # A wider window includes nearby spectral features and biases the O I
        # zero point by about 0.019 Angstrom in this observation. The 0.12
        # Angstrom window contains nine wavelength samples and isolates O I.
        oi_total, oi_centroid, _ = line_moments(oi_cube, oi_wave, O_I_REST_A, 0.12)
        oi_wide_total, oi_wide_centroid, _ = line_moments(
            oi_cube, oi_wave, O_I_REST_A, 0.28
        )

        oi_valid = np.isfinite(oi_centroid) & np.isfinite(oi_total) & (oi_total > 0)
        if int(np.count_nonzero(oi_valid)) < 100:
            raise ValueError("too few O I pixels for wavelength-drift calibration")
        oi_floor = np.nanpercentile(oi_total[oi_valid], 35)
        calibration_pixels = oi_valid & (oi_total >= oi_floor)
        wavelength_offset = float(np.nanmedian(oi_centroid[calibration_pixels]) - O_I_REST_A)
        oi_wide_valid = (
            np.isfinite(oi_wide_centroid)
            & np.isfinite(oi_wide_total)
            & (oi_wide_total > 0)
        )
        oi_wide_floor = np.nanpercentile(oi_wide_total[oi_wide_valid], 35)
        wide_wavelength_offset = float(
            np.nanmedian(oi_wide_centroid[oi_wide_valid & (oi_wide_total >= oi_wide_floor)])
            - O_I_REST_A
        )

        si_valid = np.isfinite(si_centroid) & np.isfinite(si_total) & (si_total > 0)
        if int(np.count_nonzero(si_valid)) < 100:
            raise ValueError("too few Si IV pixels for a spatially resolved diagnostic")
        high_threshold = float(np.nanpercentile(si_total[si_valid], 85))
        reference_lower = float(np.nanpercentile(si_total[si_valid], 40))
        reference_upper = float(np.nanpercentile(si_total[si_valid], 60))
        bright = si_valid & (si_total >= high_threshold)
        reference = si_valid & (si_total >= reference_lower) & (si_total <= reference_upper)
        calibrated = si_centroid - wavelength_offset
        velocity = (calibrated - SI_IV_REST_A) / SI_IV_REST_A * SPEED_OF_LIGHT_KM_S
        sigma_velocity = si_sigma / SI_IV_REST_A * SPEED_OF_LIGHT_KM_S
        hpln, hplt = helioprojective_coordinates(
            hdul[si_index].header, si_cube.shape[0], si_cube.shape[1]
        )
        footpoint = (
            si_valid
            & (hpln >= FOOTPOINT_ROI_ARCSEC["hplnMin"])
            & (hpln <= FOOTPOINT_ROI_ARCSEC["hplnMax"])
            & (hplt >= FOOTPOINT_ROI_ARCSEC["hpltMin"])
            & (hplt <= FOOTPOINT_ROI_ARCSEC["hpltMax"])
        )
        local_surrounding = (
            si_valid
            & ~footpoint
            & (hpln >= FOOTPOINT_ROI_ARCSEC["hplnMin"] - 5.6)
            & (hpln <= FOOTPOINT_ROI_ARCSEC["hplnMax"] + 5.6)
            & (hplt >= FOOTPOINT_ROI_ARCSEC["hpltMin"] - 4.0)
            & (hplt <= FOOTPOINT_ROI_ARCSEC["hpltMax"] + 4.0)
        )
        if int(np.count_nonzero(footpoint)) < 200:
            raise ValueError("literature-defined footpoint ROI has too few valid Si IV pixels")
        if int(np.count_nonzero(local_surrounding)) < 200:
            raise ValueError("footpoint comparison annulus has too few valid Si IV pixels")
        footpoint_velocity = float(np.nanmedian(velocity[footpoint]))
        surrounding_velocity = float(np.nanmedian(velocity[local_surrounding]))
        bright_velocity = float(np.nanmedian(velocity[bright]))
        reference_velocity = float(np.nanmedian(velocity[reference]))
        relative_velocity = bright_velocity - reference_velocity
        return {
            "member": member_name,
            "observationDescription": str(primary.get("OBS_DESC", "")),
            "rasterPositions": int(si_cube.shape[0]),
            "slitPixels": int(si_cube.shape[1]),
            "siIvWavelengthSamples": int(si_cube.shape[2]),
            "siIvRestWavelengthAngstrom": SI_IV_REST_A,
            "wavelengthOffsetFromOiAngstrom": wavelength_offset,
            "wideWindowOffsetSensitivityAngstrom": wide_wavelength_offset,
            "wideMinusIsolatedOiOffsetAngstrom": (
                wide_wavelength_offset - wavelength_offset
            ),
            "literatureFootpointRoiArcsec": FOOTPOINT_ROI_ARCSEC,
            "footpointPixelCount": int(np.count_nonzero(footpoint)),
            "localSurroundingPixelCount": int(np.count_nonzero(local_surrounding)),
            "footpointSiIvVelocityKmPerSecond": footpoint_velocity,
            "localSurroundingSiIvVelocityKmPerSecond": surrounding_velocity,
            "footpointMinusSurroundingVelocityKmPerSecond": (
                footpoint_velocity - surrounding_velocity
            ),
            "brightPixelCount": int(np.count_nonzero(bright)),
            "referencePixelCount": int(np.count_nonzero(reference)),
            "brightSiIvVelocityKmPerSecond": bright_velocity,
            "referenceSiIvVelocityKmPerSecond": reference_velocity,
            "brightMinusReferenceVelocityKmPerSecond": relative_velocity,
            "brightSiIvObservedSigmaKmPerSecond": float(np.nanmedian(sigma_velocity[bright])),
        }


def bootstrap_interval(values: list[float], repeats: int = 4000) -> list[float] | None:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if len(finite) < 4:
        return None
    seed = int.from_bytes(hashlib.sha256(finite.astype("<f8").tobytes()).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    medians = np.median(rng.choice(finite, size=(repeats, len(finite)), replace=True), axis=1)
    return [float(np.percentile(medians, 2.5)), float(np.percentile(medians, 97.5))]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--supplement-manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    supplement_path = args.supplement_manifest.resolve()
    dataset_root = args.dataset_root.resolve()
    supplement = json.loads(supplement_path.read_text(encoding="utf-8"))
    raster_asset = next(
        asset for asset in supplement["assets"] if asset.get("role") == "spectral-raster"
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
                rows.append(raster_diagnostic(extracted, member.name))
            except Exception as error:  # retain per-raster audit instead of hiding failures
                failures.append(f"{member.name}: {type(error).__name__}: {error}")

    velocities = [float(row["footpointSiIvVelocityKmPerSecond"]) for row in rows]
    interval = bootstrap_interval(velocities)
    median_velocity = float(np.median(velocities)) if velocities else None
    support = bool(
        median_velocity is not None
        and interval is not None
        and len(rows) >= 4
        and median_velocity >= 5.0
        and interval[0] > 0.0
    )
    quantitative = []
    if median_velocity is not None and interval is not None:
        quantitative.append(
            {
                "metric": "iris_si_iv_literature_footpoint_doppler_velocity",
                "estimate": median_velocity,
                "lowerBound": interval[0],
                "upperBound": interval[1],
                "confidenceLevel": 0.95,
                "unit": "km/s",
            }
        )
    result = json_safe(
        {
            "schemaVersion": 1,
            "scriptVersion": ANALYSIS_VERSION,
            "caseId": supplement.get("caseId"),
            "analysisSplit": supplement.get("analysisSplit"),
            "selectionFrozenBeforeAnalysis": supplement.get("selectionFrozenBeforeAnalysis"),
            "sourceManifest": str(supplement_path),
            "sourceManifestSha256": sha256(supplement_path),
            "sourceAssetId": raster_asset.get("assetId"),
            "sourceAssetSha256": raster_asset.get("sha256"),
            "observableStatus": "support" if support else "unknown",
            "rasterCount": len(rows),
            "failedRasterCount": len(failures),
            "medianLiteratureFootpointVelocityKmPerSecond": median_velocity,
            "velocityInterval95KmPerSecond": interval,
            "frozenCriterion": (
                "at least four readable rasters and the 95% raster-bootstrap interval for the "
                "median O I-calibrated Si IV velocity in the literature-defined footpoint ROI is "
                "entirely positive with median >=5 km/s"
            ),
            "wavelengthCalibration": (
                "per-raster, blend-excluding O I 1355.5988 Å median centroid offset (±0.12 Å); "
                "the primary statistic is the absolute Si IV 1393.755 Å velocity in Ghosh et al. "
                "(2017) Figure 5 region E. The full-raster "
                "bright-minus-middle statistic is retained only as a sensitivity comparison."
            ),
            "roiRegistration": {
                "kind": "literature-defined positive-control ROI",
                "boundsArcsec": FOOTPOINT_ROI_ARCSEC,
                "selectionBasis": "Ghosh et al. (2017), Figure 5 region E (5.6 x 17.84 arcsec)",
                "source": "https://doi.org/10.3847/1538-4357/835/2/244",
                "outcomeSelected": False,
            },
            "quantitativeResults": quantitative,
            "rasters": rows,
            "failures": failures,
            "boundary": (
                "This is a local-data replication of a published positive-control region, not a novel blind "
                "discovery. The Si IV Doppler signature constrains transition-region flow associated with "
                "the registered loop system. It is not by itself unique to nanoflares or magnetic reconnection; "
                "mechanism discrimination requires an independent coronal thermal diagnostic. EIS Level-0 is "
                "excluded from quantitative inference until a versioned calibration is available."
            ),
        }
    )
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({"output": str(output), "result": result}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
