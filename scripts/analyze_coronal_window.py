"""Deterministic, bounded diagnostics for the local coronal starter pack.

This is deliberately an exploratory measurement layer, not a mechanism
classifier. It reads real FITS pixels, uses one automatically selected image
region consistently across channels, and reports observable-level diagnostics
with explicit limitations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import warnings
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates, maximum_filter, minimum_filter, uniform_filter
from scipy.signal import find_peaks, periodogram
from sunpy.coordinates import Helioprojective
from sunpy.physics.differential_rotation import solar_rotate_coordinate


SCRIPT_VERSION = "5.4.0"
PREPROCESSING_VERSION = "wcs-roi-dem-v5"  # v5 = v4 + full-cadence time series (240 frames)
DIFFERENTIAL_ROTATION_MODEL = "snodgrass"
REDUCED_FRAME_TARGET = 256
MAX_SERIES_FRAMES = 240  # v5: use the full loaded cadence instead of a 96-frame cap
WCS_HEADER_KEYS = (
    "CTYPE1",
    "CTYPE2",
    "CUNIT1",
    "CUNIT2",
    "CRPIX1",
    "CRPIX2",
    "CRVAL1",
    "CRVAL2",
    "CDELT1",
    "CDELT2",
    "CROTA2",
    "RSUN_OBS",
    "DSUN_OBS",
    "BUNIT",
)

REQUIRED_LINEAR_WCS_KEYS = (
    "CTYPE1",
    "CTYPE2",
    "CRPIX1",
    "CRPIX2",
    "CRVAL1",
    "CRVAL2",
    "CDELT1",
    "CDELT2",
)
PEAK_PROMINENCE_GRID = (1.25, 1.5, 1.75, 2.0)
COOLING_SEQUENCE_PAIRS = (
    ("94 Å", "335 Å"),
    ("131 Å", "335 Å"),
    ("335 Å", "211 Å"),
    ("211 Å", "193 Å"),
    ("193 Å", "171 Å"),
)


def evenly_spaced(items: list[dict], limit: int) -> list[dict]:
    if len(items) <= limit:
        return items
    indices = np.linspace(0, len(items) - 1, limit).round().astype(int)
    return [items[int(index)] for index in sorted(set(indices.tolist()))]


def numeric_keyword(value):
    if value is None or isinstance(value, (int, float)):
        return value
    try:
        return float(str(value))
    except ValueError:
        return value


def first_image_hdu(path: Path, supplemental: dict | None = None):
    with fits.open(path, memmap=False, do_not_scale_image_data=False) as hdus:
        for hdu in hdus:
            data = getattr(hdu, "data", None)
            if data is not None and np.ndim(data) >= 2:
                header = hdu.header

                def value(key: str, default):
                    try:
                        return header.get(key, default)
                    except Exception:
                        return default

                wcs = {
                    key: value(key, None)
                    for key in WCS_HEADER_KEYS
                    if value(key, None) is not None
                }
                supplemental_keywords = (supplemental or {}).get("keywords", {})
                for key in WCS_HEADER_KEYS:
                    if key not in wcs and supplemental_keywords.get(key) not in (None, ""):
                        wcs[key] = numeric_keyword(supplemental_keywords[key])
                return np.asarray(data, dtype=np.float32), {
                    "exposure": float(value("EXPTIME", 1.0) or 1.0),
                    "quality": str(value("QUALITY", supplemental_keywords.get("QUALITY", "unknown"))),
                    "dateObs": str(
                        value(
                            "DATE-OBS",
                            value(
                                "T_OBS",
                                supplemental_keywords.get(
                                    "DATE__OBS", supplemental_keywords.get("T_OBS", "")
                                ),
                            ),
                        )
                    ),
                    "wcs": json_safe(wcs),
                    "supplementalRecordId": (supplemental or {}).get("recordId"),
                    "supplementalKeywords": json_safe(supplemental_keywords),
                }
    raise ValueError(f"no image HDU in {path}")


def cache_path_for_asset(
    cache_dir: Path, asset: dict, target: int, supplemental: dict | None = None
) -> Path:
    raw_identity = str(asset.get("sha256") or asset.get("assetId") or asset["relativePath"])
    metadata_identity = hashlib.sha256(
        json.dumps(supplemental or {}, sort_keys=True).encode("utf-8")
    ).hexdigest()
    key = hashlib.sha256(
        f"{PREPROCESSING_VERSION}:{target}:{raw_identity}:{metadata_identity}".encode("utf-8")
    ).hexdigest()
    return cache_dir / key[:2] / f"{key}.npz"


def reduced_wcs(wcs: dict, step: int) -> dict:
    result = dict(wcs)
    for axis in (1, 2):
        crpix = result.get(f"CRPIX{axis}")
        cdelt = result.get(f"CDELT{axis}")
        if isinstance(crpix, (int, float)):
            result[f"CRPIX{axis}"] = (float(crpix) - 1.0) / step + 1.0
        if isinstance(cdelt, (int, float)):
            result[f"CDELT{axis}"] = float(cdelt) * step
    return result


def has_linear_wcs(wcs: dict) -> bool:
    return all(wcs.get(key) is not None for key in REQUIRED_LINEAR_WCS_KEYS)


def wcs_object(wcs: dict) -> WCS:
    if not has_linear_wcs(wcs):
        raise ValueError("missing required linear WCS keys")
    return WCS(wcs, naxis=2)


def reproject_frame(
    frame: np.ndarray,
    source_wcs: dict,
    reference_wcs: dict,
    shape: tuple[int, int],
    source_date: str | None = None,
    reference_date: str | None = None,
    audit: dict | None = None,
) -> np.ndarray:
    """Reproject one reduced image to the frozen, surface-tracked reference grid."""
    reference = wcs_object(reference_wcs)
    source = wcs_object(source_wcs)
    yy, xx = np.indices(shape, dtype=float)
    world_x, world_y = reference.pixel_to_world_values(xx, yy)
    rotation_audit = {
        "applied": False,
        "model": DIFFERENTIAL_ROTATION_MODEL,
        "timeDeltaSeconds": 0.0,
        "centerShiftArcsec": [0.0, 0.0],
        "centerShiftPixels": [0.0, 0.0],
        "approximation": "local tangent-plane translation at the reference-grid center",
    }
    if source_date and reference_date and source_date != reference_date:
        try:
            source_time = Time(source_date)
            reference_time = Time(reference_date)
            delta_seconds = float((source_time - reference_time).to_value("s"))
            reference_unit_x = u.Unit(reference.wcs.cunit[0] or "deg")
            reference_unit_y = u.Unit(reference.wcs.cunit[1] or "deg")
            source_unit_x = u.Unit(source.wcs.cunit[0] or "deg")
            source_unit_y = u.Unit(source.wcs.cunit[1] or "deg")
            center_x, center_y = reference.pixel_to_world_values(
                (shape[1] - 1) / 2,
                (shape[0] - 1) / 2,
            )
            center = SkyCoord(
                center_x * reference_unit_x,
                center_y * reference_unit_y,
                frame=Helioprojective(observer="earth", obstime=reference_time),
            )
            rotated = solar_rotate_coordinate(
                center,
                time=source_time,
                model=DIFFERENTIAL_ROTATION_MODEL,
            )
            shift_x = (rotated.Tx - center.Tx).to(reference_unit_x).value
            shift_y = (rotated.Ty - center.Ty).to(reference_unit_y).value
            world_x = np.asarray(world_x, dtype=float) + float(shift_x)
            world_y = np.asarray(world_y, dtype=float) + float(shift_y)
            shifted_center_x = (center_x * reference_unit_x + shift_x * reference_unit_x).to(
                source_unit_x
            ).value
            shifted_center_y = (center_y * reference_unit_y + shift_y * reference_unit_y).to(
                source_unit_y
            ).value
            source_center_x, source_center_y = source.world_to_pixel_values(
                shifted_center_x,
                shifted_center_y,
            )
            unshifted_center_x, unshifted_center_y = source.world_to_pixel_values(
                (center_x * reference_unit_x).to(source_unit_x).value,
                (center_y * reference_unit_y).to(source_unit_y).value,
            )
            rotation_audit.update(
                {
                    "applied": abs(delta_seconds) > 1e-6,
                    "timeDeltaSeconds": delta_seconds,
                    "centerShiftArcsec": [
                        float((shift_x * reference_unit_x).to_value(u.arcsec)),
                        float((shift_y * reference_unit_y).to_value(u.arcsec)),
                    ],
                    "centerShiftPixels": [
                        float(source_center_x - unshifted_center_x),
                        float(source_center_y - unshifted_center_y),
                    ],
                }
            )
        except Exception as error:
            rotation_audit["error"] = str(error)
    if audit is not None:
        audit.update(json_safe(rotation_audit))
    source_x, source_y = source.world_to_pixel_values(world_x, world_y)
    sampled = map_coordinates(
        frame,
        [source_y, source_x],
        order=1,
        mode="constant",
        cval=np.nan,
        prefilter=False,
    )
    return np.asarray(sampled, dtype=np.float32)


def reduced_frame(
    path: Path,
    asset: dict,
    cache_dir: Path,
    stats: dict,
    supplemental: dict | None = None,
    target: int = REDUCED_FRAME_TARGET,
) -> tuple[np.ndarray, dict]:
    stats["requestedFrameLoads"] += 1
    source_key = str(path.resolve())
    stats["_sourcePaths"][source_key] = int(path.stat().st_size)
    cache_path = cache_path_for_asset(cache_dir, asset, target, supplemental)
    try:
        if cache_path.is_file():
            with np.load(cache_path, allow_pickle=False) as cached:
                frame = np.asarray(cached["frame"], dtype=np.float32)
                metadata = json.loads(str(cached["metadata"].item()))
            stats["cacheHits"] += 1
            stats["_cachePaths"][str(cache_path.resolve())] = int(cache_path.stat().st_size)
            return frame, metadata
    except Exception as error:
        stats["cacheReadFailures"].append(f"{asset.get('assetId', path.name)}: {error}")

    stats["cacheMisses"] += 1
    data, header = first_image_hdu(path, supplemental)
    while data.ndim > 2:
        data = data[0]
    step = max(1, int(math.ceil(max(data.shape) / target)))
    reduced = data[::step, ::step].astype(np.float32, copy=False)
    exposure = float(header["exposure"])
    if exposure > 0:
        reduced = reduced / exposure
    reduced[~np.isfinite(reduced)] = np.nan
    metadata = {
        "shape": [int(data.shape[0]), int(data.shape[1])],
        "reducedShape": [int(reduced.shape[0]), int(reduced.shape[1])],
        "stride": step,
        "exposure": exposure,
        "quality": header["quality"],
        "dateObs": header["dateObs"],
        "sourceWcs": header["wcs"],
        "reducedWcs": reduced_wcs(header["wcs"], step),
        "rawAssetId": asset.get("assetId"),
        "rawSha256": asset.get("sha256"),
        "supplementalRecordId": header.get("supplementalRecordId"),
        "supplementalKeywords": header.get("supplementalKeywords", {}),
        "preprocessingVersion": PREPROCESSING_VERSION,
    }
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_name(f".{cache_path.name}.{id(reduced)}.tmp.npz")
        np.savez_compressed(
            temporary,
            frame=reduced,
            metadata=np.asarray(json.dumps(json_safe(metadata), ensure_ascii=False)),
        )
        temporary.replace(cache_path)
        stats["_cachePaths"][str(cache_path.resolve())] = int(cache_path.stat().st_size)
    except Exception as error:
        stats["cacheWriteFailures"].append(f"{asset.get('assetId', path.name)}: {error}")
    return reduced, metadata


def normalized_crop(frame: np.ndarray, roi: dict) -> np.ndarray:
    height, width = frame.shape
    y0 = max(0, min(height - 1, int(round(roi["y0"] * height))))
    y1 = max(y0 + 1, min(height, int(round(roi["y1"] * height))))
    x0 = max(0, min(width - 1, int(round(roi["x0"] * width))))
    x1 = max(x0 + 1, min(width, int(round(roi["x1"] * width))))
    return frame[y0:y1, x0:x1]


def aligned_crop(frame: np.ndarray, metadata: dict, roi: dict) -> tuple[np.ndarray, bool]:
    reference_wcs = roi.get("referenceWcs")
    reference_shape = roi.get("referenceShape")
    source_wcs = metadata.get("reducedWcs", {})
    if reference_wcs and reference_shape and has_linear_wcs(source_wcs):
        rotation_audit: dict = {}
        registered = reproject_frame(
            frame,
            source_wcs,
            reference_wcs,
            (int(reference_shape[0]), int(reference_shape[1])),
            source_date=metadata.get("dateObs"),
            reference_date=roi.get("referenceDateObs"),
            audit=rotation_audit,
        )
        metadata["differentialRotation"] = rotation_audit
        return normalized_crop(registered, roi), True
    return normalized_crop(frame, roi), False


def attach_roi_world_metadata(roi: dict, reference_metadata: dict) -> dict:
    result = dict(roi)
    reference_wcs = reference_metadata.get("reducedWcs", {})
    reference_shape = reference_metadata.get("reducedShape")
    result["referenceWcs"] = reference_wcs
    result["referenceShape"] = reference_shape
    result["referenceDateObs"] = reference_metadata.get("dateObs")
    if has_linear_wcs(reference_wcs) and reference_shape:
        height, width = int(reference_shape[0]), int(reference_shape[1])
        points_x = np.asarray([roi["x0"] * width, roi["x1"] * width])
        points_y = np.asarray([roi["y0"] * height, roi["y1"] * height])
        world_x, world_y = wcs_object(reference_wcs).pixel_to_world_values(points_x, points_y)
        world_x_arcsec = (((np.asarray(world_x) + 180.0) % 360.0) - 180.0) * 3600.0
        world_y_arcsec = np.asarray(world_y) * 3600.0
        result["helioprojectiveBounds"] = {
            "xArcsec": [float(world_x_arcsec[0]), float(world_x_arcsec[1])],
            "yArcsec": [float(world_y_arcsec[0]), float(world_y_arcsec[1])],
        }
    return result


def select_roi(frames: list[np.ndarray]) -> dict:
    common_y = min(frame.shape[0] for frame in frames)
    common_x = min(frame.shape[1] for frame in frames)
    stack = np.stack([frame[:common_y, :common_x] for frame in frames])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        median = np.nanmedian(stack, axis=0)
        spread = np.nanmedian(np.abs(stack - median), axis=0)
    score = spread / (np.abs(median) + np.nanpercentile(np.abs(median), 30) + 1e-6)
    score[~np.isfinite(score)] = 0
    smoothed = uniform_filter(score, size=max(3, min(common_y, common_x) // 24))
    margin_y = max(2, common_y // 10)
    margin_x = max(2, common_x // 10)
    interior = smoothed[margin_y : common_y - margin_y, margin_x : common_x - margin_x]
    if interior.size == 0 or float(np.nanmax(interior)) <= 0:
        cy, cx = common_y // 2, common_x // 2
    else:
        dy, dx = np.unravel_index(int(np.nanargmax(interior)), interior.shape)
        cy, cx = int(dy + margin_y), int(dx + margin_x)
    half_y = max(6, common_y // 14)
    half_x = max(6, common_x // 14)
    return {
        "x0": max(0, cx - half_x) / common_x,
        "x1": min(common_x, cx + half_x) / common_x,
        "y0": max(0, cy - half_y) / common_y,
        "y1": min(common_y, cy + half_y) / common_y,
        "selection": "maximum robust temporal-variability region in AIA 193A",
    }


def iso_seconds(value: str) -> float:
    if value.endswith("_TAI") and "." in value:
        parsed = datetime.strptime(value, "%Y.%m.%d_%H:%M:%S_TAI")
        return parsed.replace(tzinfo=timezone.utc).timestamp()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def robust_z(values: np.ndarray) -> np.ndarray:
    median = np.nanmedian(values)
    mad = np.nanmedian(np.abs(values - median))
    scale = max(float(mad) * 1.4826, 1e-8)
    return (values - median) / scale


def relative_variability(values: np.ndarray) -> float:
    return float(np.nanstd(values) / (abs(np.nanmean(values)) + 1e-8))


def moving_block_interval(values: np.ndarray, repeats: int = 400) -> tuple[float, float] | None:
    """Deterministic 95% moving-block bootstrap interval for a time-series statistic."""
    finite = np.asarray(values, dtype=float)
    finite = finite[np.isfinite(finite)]
    if len(finite) < 8:
        return None
    block = max(2, int(round(math.sqrt(len(finite)))))
    seed_bytes = np.asarray(finite, dtype="<f8").tobytes()
    seed = int(hashlib.sha256(seed_bytes).hexdigest()[:16], 16)
    rng = np.random.default_rng(seed)
    estimates: list[float] = []
    offsets = np.arange(block)
    block_count = int(math.ceil(len(finite) / block))
    for _ in range(repeats):
        starts = rng.integers(0, len(finite), size=block_count)
        indices = ((starts[:, None] + offsets[None, :]) % len(finite)).reshape(-1)[: len(finite)]
        estimate = relative_variability(finite[indices])
        if np.isfinite(estimate):
            estimates.append(estimate)
    if len(estimates) < repeats // 2:
        return None
    lower, upper = np.quantile(np.asarray(estimates), [0.025, 0.975])
    return float(lower), float(upper)


def series_metrics(times: list[float], values: list[float], cadence: float) -> dict:
    x = np.asarray(times, dtype=float)
    y = np.asarray(values, dtype=float)
    effective_cadence = float(np.nanmedian(np.diff(x))) if len(x) > 1 else float(cadence)
    if not np.isfinite(effective_cadence) or effective_cadence <= 0:
        effective_cadence = float(cadence)
    finite = np.isfinite(x) & np.isfinite(y)
    x, y = x[finite], y[finite]
    if len(y) < 4:
        return {"count": int(len(y)), "usable": False}
    order = np.argsort(x)
    x, y = x[order], y[order]
    epoch_seconds = x.copy()
    x = x - x[0]
    slope, intercept = np.polyfit(x, y, 1)
    detrended = y - (slope * x + intercept)
    z = robust_z(detrended)
    variability = relative_variability(y)
    variability_interval = moving_block_interval(y)
    peaks, properties = find_peaks(z, prominence=1.5)
    positive_excess = np.maximum(detrended, 0.0)
    reference_level = max(abs(float(np.nanmedian(y))), 1e-8)
    event_catalog = []
    for event_index, peak in enumerate(peaks.tolist()):
        left = int(peak)
        right = int(peak)
        while left > 0 and positive_excess[left - 1] > 0 and peak - left < 8:
            left -= 1
        while (
            right + 1 < len(positive_excess)
            and positive_excess[right + 1] > 0
            and right - peak < 8
        ):
            right += 1
        event_x = x[left : right + 1]
        relative_excess = positive_excess[left : right + 1] / reference_level
        if len(event_x) >= 2:
            relative_fluence = float(np.trapezoid(relative_excess, event_x))
        else:
            relative_fluence = float(relative_excess[0] * effective_cadence)
        event_catalog.append({
            "eventIndex": event_index,
            "peakEpoch": float(epoch_seconds[peak]),
            "peakOffsetSeconds": float(x[peak]),
            "durationSeconds": float(max(effective_cadence, x[right] - x[left] + effective_cadence)),
            "peakRobustZ": float(z[peak]),
            "prominenceRobustZ": float(properties["prominences"][event_index]),
            "relativeFluenceSeconds": max(relative_fluence, 0.0),
        })
    peak_sensitivity = {
        f"{threshold:.2f}": int(len(find_peaks(z, prominence=threshold)[0]))
        for threshold in PEAK_PROMINENCE_GRID
    }
    sensitivity_counts = list(peak_sensitivity.values())
    dominant_period = None
    spectral_snr = None
    if len(y) >= 8 and effective_cadence > 0:
        frequencies, power = periodogram(detrended, fs=1.0 / effective_cadence)
        valid = frequencies > 0
        if np.any(valid):
            frequencies, power = frequencies[valid], power[valid]
            index = int(np.nanargmax(power))
            dominant_period = float(1.0 / frequencies[index])
            spectral_snr = float(power[index] / (np.nanmedian(power) + 1e-12))
    return {
        "count": int(len(y)),
        "usable": True,
        "startEpoch": float(epoch_seconds[0]),
        "durationSeconds": float(x[-1] - x[0]),
        "cadenceSeconds": effective_cadence,
        "mean": float(np.nanmean(y)),
        "std": float(np.nanstd(y)),
        "relativeVariability": variability,
        "relativeVariabilityInterval": (
            [variability_interval[0], variability_interval[1]]
            if variability_interval is not None
            else None
        ),
        "linearSlopePerHour": float(slope * 3600.0),
        "peakCount": int(len(peaks)),
        "peakCountSensitivity": peak_sensitivity,
        "peakDetectionStable": bool(
            sensitivity_counts and min(sensitivity_counts) >= 1 and max(sensitivity_counts) - min(sensitivity_counts) <= 1
        ),
        "peakProminenceMedian": float(np.nanmedian(properties["prominences"])) if len(peaks) else 0.0,
        "eventCatalog": event_catalog,
        "dominantPeriodSeconds": dominant_period,
        "spectralSnr": spectral_snr,
        "values": [float(value) for value in y],
        "timesSeconds": [float(value) for value in x],
        "epochSeconds": [float(value) for value in epoch_seconds],
    }


def pixel_scale_mm(reference_wcs: dict) -> float | None:
    arcsec = arcsec_per_pixel(reference_wcs)
    dsun = reference_wcs.get("DSUN_OBS")
    if arcsec is None:
        return None
    distance_m = float(dsun) if isinstance(dsun, (int, float)) and float(dsun) > 0 else 1.495978707e11
    return float(distance_m * math.radians(arcsec / 3600.0) / 1e6)


def lag_against(reference: np.ndarray, candidate: np.ndarray, cadence: float) -> tuple[float, float]:
    left = np.asarray(reference, dtype=float)
    right = np.asarray(candidate, dtype=float)
    finite = np.isfinite(left) & np.isfinite(right)
    left, right = left[finite], right[finite]
    if len(left) < 10 or np.nanstd(left) <= 0 or np.nanstd(right) <= 0:
        return float("nan"), float("nan")
    left = (left - np.mean(left)) / np.std(left)
    right = (right - np.mean(right)) / np.std(right)
    max_lag = max(1, min(len(left) // 4, 12))
    lags = np.arange(-max_lag, max_lag + 1)
    correlations = []
    for lag in lags:
        if lag < 0:
            a, b = left[-lag:], right[:lag]
        elif lag > 0:
            a, b = left[:-lag], right[lag:]
        else:
            a, b = left, right
        correlations.append(float(np.mean(a * b)) if len(a) >= 6 else float("nan"))
    if not np.isfinite(correlations).any():
        return float("nan"), float("nan")
    index = int(np.nanargmax(correlations))
    return float(lags[index] * cadence), float(correlations[index])


def spatial_wave_metrics(times: list[float], frames: list[np.ndarray], reference_wcs: dict) -> dict:
    if len(frames) < 16 or len(times) != len(frames):
        return {"usable": False, "reason": "fewer than 16 co-registered spatial frames"}
    height = min(frame.shape[0] for frame in frames)
    width = min(frame.shape[1] for frame in frames)
    if height < 8 or width < 8:
        return {"usable": False, "reason": "registered ROI is too small"}
    order = np.argsort(np.asarray(times, dtype=float))
    epoch = np.asarray(times, dtype=float)[order]
    stack = np.stack([frames[int(index)][:height, :width] for index in order]).astype(float)
    valid_fraction = np.mean(np.isfinite(stack), axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        fill = np.nanmedian(stack, axis=0)
    stack = np.where(np.isfinite(stack), stack, fill[None, :, :])
    x = epoch - epoch[0]
    cadence = float(np.nanmedian(np.diff(epoch)))
    if not np.isfinite(cadence) or cadence <= 0:
        return {"usable": False, "reason": "invalid spatial cadence"}
    flat = stack.reshape(len(stack), -1)
    x_centered = x - np.mean(x)
    denominator = float(np.sum(x_centered**2))
    slope = np.sum(x_centered[:, None] * (flat - np.mean(flat, axis=0)), axis=0) / max(denominator, 1e-12)
    detrended = flat - (np.mean(flat, axis=0)[None, :] + x_centered[:, None] * slope[None, :])
    roi_series = np.nanmedian(detrended, axis=1)
    frequencies, power = periodogram(roi_series, fs=1.0 / cadence)
    positive = frequencies > 0
    if not np.any(positive):
        return {"usable": False, "reason": "no positive temporal frequency"}
    frequencies, power = frequencies[positive], power[positive]
    peak_index = int(np.nanargmax(power))
    frequency = float(frequencies[peak_index])
    period = float(1.0 / frequency)
    cycles = float((x[-1] - x[0]) / period) if period > 0 else 0.0
    phase_kernel = np.exp(-2j * np.pi * frequency * x)
    coefficient = np.mean(detrended * phase_kernel[:, None], axis=0)
    amplitude = np.abs(coefficient)
    variance = np.std(detrended, axis=0)
    valid = (valid_fraction.reshape(-1) >= 0.8) & np.isfinite(amplitude) & (variance > 0)
    if np.sum(valid) < 24:
        return {"usable": False, "reason": "too few valid spatial pixels"}
    strong_threshold = float(np.nanpercentile(amplitude[valid], 75))
    strong = valid & (amplitude >= strong_threshold)
    phase = np.angle(coefficient[strong])
    phase_coherence = float(abs(np.mean(np.exp(1j * phase)))) if len(phase) else 0.0
    reference_std = float(np.std(roi_series))
    correlations = np.zeros(flat.shape[1], dtype=float)
    if reference_std > 0:
        numerator = np.mean(detrended * roi_series[:, None], axis=0)
        correlations = numerator / (np.std(detrended, axis=0) * reference_std + 1e-12)
    coherent_fraction = float(np.mean(np.abs(correlations[valid]) >= 0.5))
    low = float(np.nanpercentile(amplitude[valid], 10))
    high = float(np.nanpercentile(amplitude[valid], 90))
    node_antinode_contrast = float(high / max(low, 1e-12))

    yy, xx = np.indices((height, width), dtype=float)
    coordinates = np.column_stack([xx.reshape(-1), yy.reshape(-1)])
    weights = np.where(valid, amplitude, 0.0)
    center = np.average(coordinates, axis=0, weights=weights + 1e-12)
    centered = coordinates - center
    covariance = (centered * weights[:, None]).T @ centered / max(float(np.sum(weights)), 1e-12)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    position_pixels = centered @ axis
    usable_positions = position_pixels[valid]
    edges = np.quantile(usable_positions, np.linspace(0.05, 0.95, 9))
    bin_series: list[np.ndarray] = []
    bin_positions: list[float] = []
    for left, right in zip(edges[:-1], edges[1:], strict=True):
        mask = valid & (position_pixels >= left) & (position_pixels < right)
        if np.sum(mask) < 3:
            continue
        bin_series.append(np.nanmean(detrended[:, mask], axis=1))
        bin_positions.append(float(np.mean(position_pixels[mask])))
    propagation = {"usable": False, "reason": "fewer than six populated time-distance bins"}
    scale_mm = pixel_scale_mm(reference_wcs)
    if len(bin_series) >= 6 and scale_mm is not None:
        reference_index = len(bin_series) // 2
        lag_rows = [lag_against(bin_series[reference_index], row, cadence) for row in bin_series]
        distances = (np.asarray(bin_positions) - bin_positions[reference_index]) * scale_mm
        lag_values = np.asarray([row[0] for row in lag_rows], dtype=float)
        lag_correlations = np.asarray([row[1] for row in lag_rows], dtype=float)
        usable = np.isfinite(lag_values) & np.isfinite(lag_correlations) & (lag_correlations >= 0.25)
        if np.sum(usable) >= 5 and np.ptp(distances[usable]) > 0:
            fit = np.polyfit(distances[usable], lag_values[usable], 1)
            predicted = np.polyval(fit, distances[usable])
            residual = lag_values[usable] - predicted
            total = lag_values[usable] - np.mean(lag_values[usable])
            r_squared = float(1.0 - np.sum(residual**2) / max(float(np.sum(total**2)), 1e-12))
            slope_seconds_per_mm = float(fit[0])
            speed_km_s = (
                float(1000.0 / abs(slope_seconds_per_mm))
                if abs(slope_seconds_per_mm) > 1e-8
                else None
            )
            propagation = {
                "usable": True,
                "binCount": int(np.sum(usable)),
                "axisSelection": "weighted principal axis of periodic-amplitude map",
                "distanceSpanMm": float(np.ptp(distances[usable])),
                "lagSpanSeconds": float(np.ptp(lag_values[usable])),
                "medianLagCorrelation": float(np.median(lag_correlations[usable])),
                "lagDistanceR2": r_squared,
                "slopeSecondsPerMm": slope_seconds_per_mm,
                "apparentPropagationSpeedKmPerSecond": speed_km_s,
                "directionSign": int(np.sign(slope_seconds_per_mm)),
            }
    spatial_support = bool(
        cycles >= 2.0
        and phase_coherence >= 0.6
        and coherent_fraction >= 0.2
        and node_antinode_contrast >= 1.5
    )
    propagation_support = bool(
        propagation.get("usable")
        and propagation.get("lagDistanceR2", 0) >= 0.6
        and propagation.get("apparentPropagationSpeedKmPerSecond") is not None
        and 10 <= propagation["apparentPropagationSpeedKmPerSecond"] <= 3000
    )
    return {
        "usable": True,
        "frameCount": len(frames),
        "cadenceSeconds": cadence,
        "dominantPeriodSeconds": period,
        "cyclesCovered": cycles,
        "spectralSnr": float(power[peak_index] / (np.nanmedian(power) + 1e-12)),
        "phaseCoherence": phase_coherence,
        "coherentPixelFractionAbsCorrelationGte0_5": coherent_fraction,
        "nodeAntinodeAmplitudeContrastP90P10": node_antinode_contrast,
        "spatialCoherenceObservableStatus": "support" if spatial_support else "unknown",
        "propagationObservableStatus": "support" if propagation_support else "unknown",
        "propagation": propagation,
        "boundary": (
            "空间轴由降采样 ROI 的周期振幅自动估计，并非人工追踪的单根日冕环；"
            "表观传播速度和节点/反节点代理必须与背景窗比较，不能单独证明波加热。"
        ),
    }


def correlation_metrics(left: dict | None, right: dict | None) -> dict:
    if not left or not right or not left.get("usable") or not right.get("usable"):
        return {"usable": False}
    left_t = np.asarray(left.get("epochSeconds", left["timesSeconds"]), dtype=float)
    right_t = np.asarray(right.get("epochSeconds", right["timesSeconds"]), dtype=float)
    start = max(float(left_t.min()), float(right_t.min()))
    end = min(float(left_t.max()), float(right_t.max()))
    cadence = max(float(left["cadenceSeconds"]), float(right["cadenceSeconds"]))
    if end - start < cadence * 4:
        return {"usable": False}
    grid = np.arange(start, end + cadence / 2, cadence)
    a = robust_z(np.interp(grid, left_t, np.asarray(left["values"], dtype=float)))
    b = robust_z(np.interp(grid, right_t, np.asarray(right["values"], dtype=float)))
    denominator = math.sqrt(float(np.sum(a * a) * np.sum(b * b))) + 1e-12
    corr = np.correlate(a, b, mode="full") / denominator
    lags = np.arange(-len(grid) + 1, len(grid)) * cadence
    index = int(np.nanargmax(corr))
    estimate = float(np.clip(corr[index], -0.999999, 0.999999))
    correlation_interval = None
    if len(grid) > 3:
        standard_error = 1.0 / math.sqrt(len(grid) - 3)
        center = math.atanh(estimate)
        correlation_interval = [
            float(math.tanh(center - 1.96 * standard_error)),
            float(math.tanh(center + 1.96 * standard_error)),
        ]
    return {
        "usable": True,
        "correlation": estimate,
        "correlationInterval": correlation_interval,
        "lagSeconds": float(lags[index]),
        "sampleCount": int(len(grid)),
    }


def magnetic_spatial_proxies(crop: np.ndarray) -> dict:
    finite = np.asarray(crop, dtype=float)
    mask = np.isfinite(finite)
    if int(mask.sum()) < 16:
        return {"usable": False}
    fill = float(np.nanmedian(finite))
    data = np.where(mask, finite, fill)
    gy, gx = np.gradient(data)
    gradient = np.sqrt(gx * gx + gy * gy)
    positive_nearby = maximum_filter(data, size=3) > 0
    negative_nearby = minimum_filter(data, size=3) < 0
    scale = max(float(np.nanpercentile(np.abs(data), 90)), 1e-8)
    pil = positive_nearby & negative_nearby & (np.abs(data) <= 0.15 * scale) & mask
    return {
        "usable": True,
        "signedMeanProxy": float(np.nanmean(data[mask])),
        "unsignedMeanProxy": float(np.nanmean(np.abs(data[mask]))),
        "gradientMedianProxy": float(np.nanmedian(gradient[mask])),
        "pilNeighborhoodFractionProxy": float(np.mean(pil[mask])),
    }


def arcsec_per_pixel(wcs: dict) -> float | None:
    value = numeric_keyword(wcs.get("CDELT1"))
    if not isinstance(value, (int, float)) or not np.isfinite(value):
        return None
    unit = str(wcs.get("CUNIT1", "deg")).lower()
    factor = 3600.0 if "deg" in unit else 1.0
    return abs(float(value)) * factor


def magnetic_spatial_metrics(crop: np.ndarray, reference_wcs: dict, hmi_metadata: dict) -> dict:
    """Compute projected LOS magnetic observables on the common AIA grid."""
    proxy = magnetic_spatial_proxies(crop)
    keywords = hmi_metadata.get("supplementalKeywords", {})
    unit = str(hmi_metadata.get("reducedWcs", {}).get("BUNIT", ""))
    dsun_m = numeric_keyword(keywords.get("DSUN_OBS"))
    pixel_arcsec = arcsec_per_pixel(reference_wcs)
    if (
        not proxy.get("usable")
        or unit.lower() not in {"gauss", "g"}
        or not isinstance(dsun_m, (int, float))
        or not isinstance(pixel_arcsec, (int, float))
        or dsun_m <= 0
        or pixel_arcsec <= 0
    ):
        return {**proxy, "physicalUsable": False}
    data = np.asarray(crop, dtype=float)
    mask = np.isfinite(data)
    fill = float(np.nanmedian(data))
    data = np.where(mask, data, fill)
    pixel_length_m = float(dsun_m) * math.radians(float(pixel_arcsec) / 3600.0)
    pixel_length_mm = pixel_length_m / 1e6
    pixel_area_cm2 = (pixel_length_m * 100.0) ** 2
    gy, gx = np.gradient(data, pixel_length_mm, pixel_length_mm)
    gradient = np.sqrt(gx * gx + gy * gy)
    threshold = 50.0
    positive = maximum_filter(data, size=3) >= threshold
    negative = minimum_filter(data, size=3) <= -threshold
    pil = positive & negative & mask
    horizontal_crossings = (
        mask[:, :-1]
        & mask[:, 1:]
        & (data[:, :-1] * data[:, 1:] < 0)
        & (np.maximum(np.abs(data[:, :-1]), np.abs(data[:, 1:])) >= threshold)
    )
    vertical_crossings = (
        mask[:-1, :]
        & mask[1:, :]
        & (data[:-1, :] * data[1:, :] < 0)
        & (np.maximum(np.abs(data[:-1, :]), np.abs(data[1:, :])) >= threshold)
    )
    pil_edge_count = int(np.sum(horizontal_crossings) + np.sum(vertical_crossings))
    # Sign-changing grid edges give a reproducible coarse-resolution length
    # proxy, not a vector-field topology reconstruction.
    return {
        **proxy,
        "physicalUsable": True,
        "fieldUnit": "G",
        "pixelScaleArcsec": float(pixel_arcsec),
        "projectedPixelLengthMm": pixel_length_mm,
        "projectedPixelAreaCm2": pixel_area_cm2,
        "signedLosFluxMx": float(np.sum(data[mask]) * pixel_area_cm2),
        "unsignedLosFluxMx": float(np.sum(np.abs(data[mask])) * pixel_area_cm2),
        "gradientMedianGPerMm": float(np.nanmedian(gradient[mask])),
        "gradientP95GPerMm": float(np.nanpercentile(gradient[mask], 95)),
        "pilLengthProxyMm": float(pil_edge_count * pixel_length_mm),
        "pilSignChangingEdgeCount": pil_edge_count,
        "pilNeighborhoodMeanAbsFieldG": (
            float(np.nanmean(np.abs(data[pil]))) if np.any(pil) else 0.0
        ),
        "pilFieldThresholdG": threshold,
    }


def deterministic_slope_interval(
    times: list[float], values: list[float], repeats: int = 400
) -> list[float] | None:
    if len(times) != len(values) or len(values) < 8:
        return None
    x = np.asarray(times, dtype=float)
    y = np.asarray(values, dtype=float)
    finite = np.isfinite(x) & np.isfinite(y)
    x, y = x[finite], y[finite]
    if len(y) < 8:
        return None
    x = x - x[0]
    block = max(2, int(round(math.sqrt(len(y)))))
    seed = int(hashlib.sha256(np.asarray([x, y], dtype="<f8").tobytes()).hexdigest()[:16], 16)
    rng = np.random.default_rng(seed)
    offsets = np.arange(block)
    block_count = int(math.ceil(len(y) / block))
    slopes = []
    for _ in range(repeats):
        starts = rng.integers(0, len(y), size=block_count)
        indices = ((starts[:, None] + offsets[None, :]) % len(y)).reshape(-1)[: len(y)]
        order = np.argsort(x[indices])
        candidate_x, candidate_y = x[indices][order], y[indices][order]
        if np.unique(candidate_x).size >= 3:
            slopes.append(float(np.polyfit(candidate_x, candidate_y, 1)[0] * 3600.0))
    if len(slopes) < repeats // 2:
        return None
    return [float(value) for value in np.quantile(slopes, [0.025, 0.975])]


def holm_adjust(p_values: list[float]) -> list[float]:
    if not p_values:
        return []
    order = np.argsort(np.asarray(p_values))
    adjusted = np.ones(len(p_values), dtype=float)
    running = 0.0
    total = len(p_values)
    for rank, index in enumerate(order):
        candidate = min(1.0, float(p_values[int(index)]) * (total - rank))
        running = max(running, candidate)
        adjusted[int(index)] = running
    return adjusted.tolist()


def positive_lag_cooling_pair(source: dict | None, cool: dict | None, repeats: int = 399) -> dict:
    """Pre-registered positive-lag cross-correlation with a circular-shift null."""
    if not source or not cool or not source.get("usable") or not cool.get("usable"):
        return {"usable": False, "reason": "channel series unavailable"}
    source_t = np.asarray(source.get("epochSeconds", source["timesSeconds"]), dtype=float)
    cool_t = np.asarray(cool.get("epochSeconds", cool["timesSeconds"]), dtype=float)
    start = max(float(source_t.min()), float(cool_t.min()))
    end = min(float(source_t.max()), float(cool_t.max()))
    cadence = max(float(source["cadenceSeconds"]), float(cool["cadenceSeconds"]))
    if end - start < cadence * 8:
        return {"usable": False, "reason": "fewer than eight common cadence intervals"}
    grid = np.arange(start, end + cadence / 2, cadence)
    left = robust_z(np.interp(grid, source_t, np.asarray(source["values"], dtype=float)))
    right = robust_z(np.interp(grid, cool_t, np.asarray(cool["values"], dtype=float)))
    max_lag_steps = min(6, max(1, len(grid) // 3))

    def correlations(candidate: np.ndarray) -> np.ndarray:
        values = []
        for lag in range(1, max_lag_steps + 1):
            a, b = left[:-lag], candidate[lag:]
            if len(a) < 6 or float(np.std(a)) == 0 or float(np.std(b)) == 0:
                values.append(float("nan"))
            else:
                values.append(float(np.corrcoef(a, b)[0, 1]))
        return np.asarray(values, dtype=float)

    observed = correlations(right)
    if not np.any(np.isfinite(observed)):
        return {"usable": False, "reason": "correlation undefined"}
    selected = int(np.nanargmax(observed))
    estimate = float(observed[selected])
    seed = int(hashlib.sha256(np.asarray([left, right], dtype="<f8").tobytes()).hexdigest()[:16], 16)
    rng = np.random.default_rng(seed)
    null_maxima = []
    allowed_shifts = np.arange(2, max(3, len(right) - 1))
    for _ in range(repeats):
        shifted = np.roll(right, int(rng.choice(allowed_shifts)))
        candidate = correlations(shifted)
        if np.any(np.isfinite(candidate)):
            null_maxima.append(float(np.nanmax(candidate)))
    p_value = (
        (1 + sum(value >= estimate for value in null_maxima)) / (1 + len(null_maxima))
        if null_maxima
        else 1.0
    )
    selected_lag = selected + 1
    selected_left = left[:-selected_lag]
    selected_right = right[selected_lag:]
    block = max(2, int(round(math.sqrt(len(selected_left)))))
    offsets = np.arange(block)
    block_count = int(math.ceil(len(selected_left) / block))
    interval_rng = np.random.default_rng(seed ^ 0x9E3779B97F4A7C15)
    bootstrap_correlations = []
    for _ in range(repeats):
        starts = interval_rng.integers(0, len(selected_left), size=block_count)
        indices = (
            (starts[:, None] + offsets[None, :]) % len(selected_left)
        ).reshape(-1)[: len(selected_left)]
        candidate_left = selected_left[indices]
        candidate_right = selected_right[indices]
        if float(np.std(candidate_left)) > 0 and float(np.std(candidate_right)) > 0:
            bootstrap_correlations.append(
                float(np.corrcoef(candidate_left, candidate_right)[0, 1])
            )
    correlation_interval = (
        [float(value) for value in np.quantile(bootstrap_correlations, [0.025, 0.975])]
        if len(bootstrap_correlations) >= repeats // 2
        else None
    )
    return {
        "usable": True,
        "lagSeconds": float(selected_lag * cadence),
        "lagCadenceSteps": selected_lag,
        "correlation": estimate,
        "correlationInterval95MovingBlock": correlation_interval,
        "pValueCircularShiftMaxLag": float(p_value),
        "sampleCount": int(len(grid) - selected - 1),
        "testedPositiveLagSteps": int(max_lag_steps),
    }


def cooling_sequence_diagnostic(channels: dict[str, dict]) -> dict:
    def best(band: str) -> dict | None:
        candidates = [value for key, value in channels.items() if key.endswith(f":{band}")]
        core = [value for value in candidates if "core" in str(value.get("streamId", ""))]
        if core:
            candidates = core
        return max(candidates, key=lambda item: item.get("count", 0), default=None)

    pairs = []
    raw_p = []
    for source_band, cool_band in COOLING_SEQUENCE_PAIRS:
        result = positive_lag_cooling_pair(best(source_band), best(cool_band))
        row = {"sourceBand": source_band, "coolBand": cool_band, **result}
        pairs.append(row)
        if result.get("usable"):
            raw_p.append(float(result["pValueCircularShiftMaxLag"]))
    adjusted = holm_adjust(raw_p)
    position = 0
    for row in pairs:
        if row.get("usable"):
            row["holmAdjustedPValue"] = adjusted[position]
            row["passesFrozenCriterion"] = bool(
                row.get("correlation", -1) >= 0.45 and adjusted[position] <= 0.05
            )
            position += 1
    usable = [row for row in pairs if row.get("usable")]
    passing = [row for row in usable if row.get("passesFrozenCriterion")]
    quantitative = []
    for row in passing:
        interval = row.get("correlationInterval95MovingBlock")
        if not interval:
            continue
        source_name = str(row["sourceBand"]).replace(" Å", "")
        cool_name = str(row["coolBand"]).replace(" Å", "")
        quantitative.append(
            {
                "metric": f"aia_cooling_{source_name}_to_{cool_name}_lag_correlation",
                "estimate": float(row["correlation"]),
                "lowerBound": float(interval[0]),
                "upperBound": float(interval[1]),
                "confidenceLevel": 0.95,
                "unit": "1",
            }
        )
    return {
        "observableStatus": "support" if len(usable) == len(pairs) and len(passing) >= 4 else "unknown",
        "pairCount": len(pairs),
        "usablePairCount": len(usable),
        "passingPairCount": len(passing),
        "pairs": pairs,
        "frozenCriterion": "at least 4/5 positive-lag pairs with r>=0.45 and Holm-adjusted circular-shift p<=0.05",
        "uncertaintyMethod": (
            "paired moving-block bootstrap at the selected positive lag; maximum-lag selection is "
            "controlled separately by the circular-shift null and Holm family-wise correction"
        ),
        "boundary": (
            "AIA 通道峰值/相关时延是热演化代理；即使另有 ROI 中位强度 DEM，"
            "冷却时延也只能检验与某类预测是否相容，不能唯一识别加热机制。"
        ),
        "quantitativeResults": quantitative,
    }


def dem_temperature_diagnostic(channels: dict[str, dict]) -> dict:
    """Regularized six-channel AIA DEM on the common ROI-median time grid."""
    bands = ("94 Å", "131 Å", "171 Å", "193 Å", "211 Å", "335 Å")

    def best(band: str) -> dict | None:
        candidates = [value for key, value in channels.items() if key.endswith(f":{band}")]
        core = [value for value in candidates if "core" in str(value.get("streamId", ""))]
        return max(core or candidates, key=lambda item: item.get("count", 0), default=None)

    selected = [best(band) for band in bands]
    if any(item is None or not item.get("usable") for item in selected):
        return {
            "observableStatus": "unknown",
            "usable": False,
            "reason": "six co-spatial AIA core channels are required",
            "quantitativeResults": [],
            "boundary": "DEM 需要 94/131/171/193/211/335 Å 六通道共同覆盖。",
        }
    starts = [min(item["epochSeconds"]) for item in selected]
    ends = [max(item["epochSeconds"]) for item in selected]
    cadence = max(float(item["cadenceSeconds"]) for item in selected)
    start, end = max(starts), min(ends)
    if end - start < cadence * 5:
        return {
            "observableStatus": "unknown",
            "usable": False,
            "reason": "fewer than six common time samples",
            "quantitativeResults": [],
            "boundary": "六通道共同时间范围不足，未执行 DEM。",
        }
    grid = np.arange(start, end + cadence / 2.0, cadence)
    dn = np.column_stack(
        [
            np.interp(
                grid,
                np.asarray(item["epochSeconds"], dtype=float),
                np.asarray(item["values"], dtype=float),
            )
            for item in selected
        ]
    )
    dn = np.maximum(dn, 1e-3)
    # A 20% response/calibration floor is explicit. The Poisson-like term is
    # only an approximation because the input is an ROI median in DN/s.
    edn = np.sqrt(np.maximum(dn, 1.0) + np.square(0.20 * dn))
    try:
        from demregpy import dn2dem, load_aia_response

        response_bands, response_logt, response = load_aia_response()
        expected = ["A94", "A131", "A171", "A193", "A211", "A335"]
        if list(response_bands) != expected:
            raise ValueError(f"unexpected AIA response order: {response_bands}")
        response_sha256 = hashlib.sha256(
            np.asarray(response_logt, dtype="<f8").tobytes()
            + np.asarray(response, dtype="<f8").tobytes()
        ).hexdigest()
        temperature_edges = 10.0 ** np.arange(5.6, 7.31, 0.1)
        dem, edem, elogt, chisq, reconstructed = dn2dem(
            dn,
            edn,
            response,
            response_logt,
            temperature_edges,
            nmu=40,
            warn=False,
        )
    except Exception as error:
        return {
            "observableStatus": "unknown",
            "usable": False,
            "reason": f"DEM inversion failed: {error}",
            "quantitativeResults": [],
            "boundary": "DEM 依赖固定版本温度响应与正则化反演环境。",
        }
    dem = np.asarray(dem, dtype=float)
    edem = np.asarray(edem, dtype=float)
    chisq = np.asarray(chisq, dtype=float)
    reconstructed = np.asarray(reconstructed, dtype=float)
    centers_k = np.sqrt(temperature_edges[:-1] * temperature_edges[1:])
    centers_logt = np.log10(centers_k)
    widths = np.diff(temperature_edges)
    emission = dem * widths[None, :]
    emission_error = edem * widths[None, :]
    total_em = np.sum(emission, axis=1)
    denominator = np.maximum(total_em, 1e-30)
    weighted_logt = np.sum(emission * centers_logt[None, :], axis=1) / denominator
    weighted_logt_error = np.sqrt(
        np.sum(
            np.square(
                emission_error
                * (centers_logt[None, :] - weighted_logt[:, None])
                / denominator[:, None]
            ),
            axis=1,
        )
    )
    peak_logt = centers_logt[np.argmax(dem, axis=1)]
    hot_mask = centers_logt >= 6.7
    hot_fraction = np.sum(emission[:, hot_mask], axis=1) / denominator
    residual_sigma = (reconstructed - dn) / edn
    nonnegative_fraction = float(np.mean(dem >= 0))
    median_chisq = float(np.nanmedian(chisq))
    fit_ready = bool(
        np.isfinite(median_chisq)
        and median_chisq <= 5.0
        and nonnegative_fraction >= 0.99
        and np.all(np.isfinite(weighted_logt))
    )
    mean_logt = float(np.nanmean(weighted_logt))
    mean_logt_uncertainty = float(
        math.sqrt(
            np.nanmean(np.square(weighted_logt_error))
            + np.nanvar(weighted_logt, ddof=1) / max(len(weighted_logt), 1)
        )
    )
    return {
        "observableStatus": "support" if fit_ready else "unknown",
        "usable": True,
        "method": "Hannah-Kontar-style regularized inversion via demregpy 1.0.0",
        "responseModel": "bundled six-channel SDO/AIA temperature response",
        "responseSha256": response_sha256,
        "responseBands": expected,
        "timeSampleCount": int(len(grid)),
        "cadenceSeconds": float(cadence),
        "temperatureBinEdgesLog10K": [float(value) for value in np.log10(temperature_edges)],
        "emWeightedLog10Temperature": [float(value) for value in weighted_logt],
        "emWeightedLog10TemperatureUncertainty1Sigma": [
            float(value) for value in weighted_logt_error
        ],
        "peakLog10Temperature": [float(value) for value in peak_logt],
        "hotEmissionFractionAboveLogT6_7": [float(value) for value in hot_fraction],
        "totalEmissionMeasureCmMinus5": [float(value) for value in total_em],
        "meanEmWeightedLog10Temperature": mean_logt,
        "meanHotEmissionFractionAboveLogT6_7": float(np.nanmean(hot_fraction)),
        "medianTotalEmissionMeasureCmMinus5": float(np.nanmedian(total_em)),
        "medianReducedChiSquare": median_chisq,
        "reducedChiSquareP10P90": [
            float(value) for value in np.nanquantile(chisq, [0.1, 0.9])
        ],
        "nonnegativeDemFraction": nonnegative_fraction,
        "medianAbsoluteReconstructionResidualSigma": float(
            np.nanmedian(np.abs(residual_sigma))
        ),
        "assumedFractionalCalibrationUncertainty": 0.20,
        "quantitativeResults": [
            {
                "metric": "aia_dem_em_weighted_log10_temperature",
                "estimate": mean_logt,
                "lowerBound": mean_logt - 1.96 * mean_logt_uncertainty,
                "upperBound": mean_logt + 1.96 * mean_logt_uncertainty,
                "confidenceLevel": 0.95,
                "unit": "log10(K)",
            },
            {
                "metric": "aia_dem_median_reduced_chi_square",
                "estimate": median_chisq,
                "unit": "1",
            },
        ],
        "boundary": (
            "这是六个 AIA 通道在冻结 ROI 内中位强度的正则化 DEM，包含 20% 响应/标定误差底限；"
            "未做逐像素 PSF/散射光校正，DEM 多温结构与加热机制不是一一对应关系。"
        ),
    }


def merged_hot_events(channels: dict[str, dict]) -> list[dict]:
    selected = []
    for band in ("94 Å", "131 Å"):
        candidates = [value for key, value in channels.items() if key.endswith(f":{band}")]
        core = [value for value in candidates if "core" in str(value.get("streamId", ""))]
        channel = max(core or candidates, key=lambda item: item.get("count", 0), default=None)
        if channel:
            for event in channel.get("eventCatalog", []):
                selected.append(
                    {
                        **event,
                        "band": band,
                        "cadenceSeconds": channel.get("cadenceSeconds", 0),
                    }
                )
    selected.sort(key=lambda row: row["peakEpoch"])
    merged: list[dict] = []
    for event in selected:
        tolerance = max(60.0, float(event.get("cadenceSeconds", 0)) * 1.5)
        if merged and abs(float(event["peakEpoch"]) - float(merged[-1]["peakEpoch"])) <= tolerance:
            previous = merged[-1]
            previous["peakEpoch"] = float(
                np.mean([previous["peakEpoch"], event["peakEpoch"]])
            )
            previous["relativeFluenceSeconds"] = float(
                np.mean(
                    [
                        previous["relativeFluenceSeconds"],
                        event["relativeFluenceSeconds"],
                    ]
                )
            )
            previous["durationSeconds"] = float(
                max(previous["durationSeconds"], event["durationSeconds"])
            )
            previous["bands"] = sorted(set([*previous["bands"], event["band"]]))
        else:
            merged.append(
                {
                    "peakEpoch": float(event["peakEpoch"]),
                    "durationSeconds": float(event["durationSeconds"]),
                    "relativeFluenceSeconds": float(event["relativeFluenceSeconds"]),
                    "bands": [event["band"]],
                }
            )
    return merged


def power_law_proxy_fit(values: list[float], repeats: int = 399) -> dict:
    finite = np.asarray(
        [value for value in values if np.isfinite(value) and value > 0], dtype=float
    )
    if len(finite) < 8:
        return {
            "usable": False,
            "reason": "fewer than eight positive event-fluence proxies",
        }
    xmin = float(np.median(finite))
    tail = finite[finite >= xmin]
    if len(tail) < 4:
        return {"usable": False, "reason": "power-law tail has fewer than four events"}

    def alpha(sample: np.ndarray) -> float:
        denominator = float(np.sum(np.log(sample / xmin)))
        return (
            float(1.0 + len(sample) / denominator)
            if denominator > 0
            else float("nan")
        )

    estimate = alpha(tail)
    if not np.isfinite(estimate):
        return {"usable": False, "reason": "power-law exponent is undefined"}
    ordered = np.sort(tail)
    empirical = np.arange(1, len(ordered) + 1) / len(ordered)
    model = 1.0 - np.power(ordered / xmin, 1.0 - estimate)
    ks_distance = float(np.max(np.abs(empirical - model)))
    seed = int(
        hashlib.sha256(np.asarray(tail, dtype="<f8").tobytes()).hexdigest()[:16], 16
    )
    rng = np.random.default_rng(seed)
    bootstrapped = []
    for _ in range(repeats):
        value = alpha(rng.choice(tail, size=len(tail), replace=True))
        if np.isfinite(value):
            bootstrapped.append(value)
    interval = (
        [float(value) for value in np.quantile(bootstrapped, [0.025, 0.975])]
        if len(bootstrapped) >= repeats // 2
        else None
    )
    return {
        "usable": True,
        "eventCount": int(len(finite)),
        "tailCount": int(len(tail)),
        "tailThresholdRelativeFluenceSeconds": xmin,
        "powerLawExponent": estimate,
        "powerLawExponentInterval95": interval,
        "ksDistance": ks_distance,
        "fitMethod": "continuous-tail MLE above the frozen median detected-event fluence",
    }


def two_sample_ks_distance(left: list[float], right: list[float]) -> float | None:
    a = np.sort(np.asarray([value for value in left if np.isfinite(value)], dtype=float))
    b = np.sort(np.asarray([value for value in right if np.isfinite(value)], dtype=float))
    if len(a) < 3 or len(b) < 3:
        return None
    grid = np.sort(np.unique(np.concatenate([a, b])))
    left_cdf = np.searchsorted(a, grid, side="right") / len(a)
    right_cdf = np.searchsorted(b, grid, side="right") / len(b)
    return float(np.max(np.abs(left_cdf - right_cdf)))


def event_fluence_distribution_diagnostic(target: dict, baseline: dict | None) -> dict:
    events = merged_hot_events(target["channels"])
    fluences = [float(row["relativeFluenceSeconds"]) for row in events]
    fit = power_law_proxy_fit(fluences)
    background_events = merged_hot_events(baseline["channels"]) if baseline else []
    background_fluences = [
        float(row["relativeFluenceSeconds"]) for row in background_events
    ]
    background_ks = two_sample_ks_distance(fluences, background_fluences)
    hot_channels = [
        value
        for key, value in target["channels"].items()
        if key.endswith(":94 Å") or key.endswith(":131 Å")
    ]
    sensitivity_counts = {
        f"{threshold:.2f}": sum(
            int(channel.get("peakCountSensitivity", {}).get(f"{threshold:.2f}", 0))
            for channel in hot_channels
        )
        for threshold in PEAK_PROMINENCE_GRID
    }
    sensitivity_values = list(sensitivity_counts.values())
    threshold_detection_persistence = (
        float(min(sensitivity_values) / max(sensitivity_values))
        if sensitivity_values and max(sensitivity_values) > 0
        else 0.0
    )
    threshold_robust = bool(
        sensitivity_values
        and min(sensitivity_values) >= 2
        and threshold_detection_persistence >= 1.0 / 3.0
    )
    fit_support = bool(
        fit.get("usable")
        and fit.get("powerLawExponentInterval95")
        and fit["ksDistance"] <= 0.35
        and fit["powerLawExponentInterval95"][1]
        - fit["powerLawExponentInterval95"][0]
        <= 2.5
        and threshold_robust
    )
    quantitative = []
    if fit.get("usable") and fit.get("powerLawExponentInterval95"):
        quantitative.append(
            {
                "metric": "aia_hot_event_relative_fluence_power_law_exponent",
                "estimate": float(fit["powerLawExponent"]),
                "lowerBound": float(fit["powerLawExponentInterval95"][0]),
                "upperBound": float(fit["powerLawExponentInterval95"][1]),
                "confidenceLevel": 0.95,
                "unit": "1",
            }
        )
    duration = (
        max(row["peakEpoch"] for row in events)
        - min(row["peakEpoch"] for row in events)
        if len(events) >= 2
        else 0.0
    )
    return {
        "observableStatus": "support" if fit_support else "unknown",
        "eventCount": len(events),
        "backgroundEventCount": len(background_events),
        "eventRatePerHour": float(len(events) / max(duration, 3600.0) * 3600.0),
        "powerLawProxyFit": fit,
        "targetBackgroundKsDistance": background_ks,
        "eventThresholdSensitivity": {
            "prominenceGrid": list(PEAK_PROMINENCE_GRID),
            "combinedHotChannelPeakCounts": sensitivity_counts,
            "detectionPersistence": threshold_detection_persistence,
            "stable": threshold_robust,
            "frozenCriterion": (
                "all thresholds detect at least two channel peaks and min/max count >=1/3"
            ),
        },
        "events": events,
        "quantitativeResults": quantitative,
        "boundary": (
            "事件量是曝光归一化 ROI 强度超额的相对 fluence（秒），不是辐射能或总加热能；"
            "有限事件的幂律相容性也不是纳耀斑机制的唯一指纹。"
        ),
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, (float, np.floating)) and not math.isfinite(float(value)):
        return None
    if isinstance(value, np.generic):
        return value.item()
    return value


def has_acceptable_quality(asset: dict, observation: dict) -> bool:
    quality = str(observation.get("quality") or asset.get("quality") or "").strip()
    if not quality:
        return True
    try:
        return int(quality, 0) == 0
    except ValueError:
        return True


def load_metadata_supplements(manifest: dict, root: Path) -> tuple[dict[str, dict], list[dict]]:
    assets: dict[str, dict] = {}
    audit: list[dict] = []
    for supplement in manifest.get("metadataSupplements", []):
        relative_path = supplement.get("relativePath")
        if not relative_path:
            continue
        path = root / str(relative_path)
        row = {
            "kind": supplement.get("kind"),
            "relativePath": str(relative_path),
            "expectedSha256": supplement.get("sha256"),
            "available": path.is_file(),
            "checksumVerified": False,
            "assetCount": 0,
        }
        if path.is_file():
            actual = sha256(path)
            row["actualSha256"] = actual
            row["checksumVerified"] = actual.lower() == str(supplement.get("sha256", "")).lower()
            if row["checksumVerified"]:
                payload = json.loads(path.read_text(encoding="utf-8"))
                supplied_assets = payload.get("assets", {})
                if isinstance(supplied_assets, dict):
                    assets.update(supplied_assets)
                    row["assetCount"] = len(supplied_assets)
        audit.append(row)
    return assets, audit


def load_vector_supplement(manifest: dict, root: Path) -> tuple[dict | None, list[dict]]:
    audit: list[dict] = []
    for supplement in manifest.get("dataSupplements", []):
        if supplement.get("kind") != "hmi-sharp-vector":
            continue
        relative_path = str(supplement.get("relativePath") or "")
        path = root / relative_path
        row = {
            "kind": "hmi-sharp-vector",
            "relativePath": relative_path,
            "available": path.is_file(),
            "checksumVerified": False,
            "complete": False,
        }
        if path.is_file():
            actual = sha256(path)
            row["actualSha256"] = actual
            row["checksumVerified"] = actual.lower() == str(
                supplement.get("sha256", "")
            ).lower()
            if row["checksumVerified"]:
                payload = json.loads(path.read_text(encoding="utf-8"))
                row["complete"] = bool(payload.get("complete"))
                row["assetCount"] = int(payload.get("assetCount", 0))
                audit.append(row)
                return payload if row["complete"] else None, audit
        audit.append(row)
    return None, audit


def load_spectroscopy_diagnostic(
    manifest: dict, root: Path, case_id: str
) -> tuple[dict, list[dict]]:
    audit: list[dict] = []
    for reference in manifest.get("dataSupplements", []):
        if not str(reference.get("kind", "")).startswith("joint-spectroscopy-"):
            continue
        manifest_path = root / str(reference.get("relativePath", ""))
        row = {
            "kind": reference.get("kind"),
            "relativePath": reference.get("relativePath"),
            "complete": False,
        }
        if (
            not manifest_path.is_file()
            or sha256(manifest_path) != str(reference.get("sha256", ""))
        ):
            row["reason"] = "supplement manifest missing or SHA-256 mismatch"
            audit.append(row)
            continue
        supplement = json.loads(manifest_path.read_text(encoding="utf-8"))
        if supplement.get("caseId") != case_id:
            row["reason"] = "supplement belongs to a different case"
            audit.append(row)
            continue
        output = (
            root
            / "derived"
            / "iris-spectroscopy-v4"
            / case_id
            / "spectroscopy_metrics.json"
        )
        if not output.is_file():
            analyzer = Path(__file__).with_name("analyze_joint_spectroscopy.py")
            subprocess.run(
                [
                    sys.executable,
                    str(analyzer),
                    "--supplement-manifest",
                    str(manifest_path),
                    "--dataset-root",
                    str(root),
                    "--output",
                    str(output),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        diagnostic = json.loads(output.read_text(encoding="utf-8"))
        if diagnostic.get("sourceManifestSha256") != sha256(manifest_path):
            raise ValueError("stale IRIS spectroscopy diagnostic provenance")
        row.update(
            {
                "complete": True,
                "diagnosticPath": str(output.relative_to(root)).replace("\\", "/"),
                "diagnosticSha256": sha256(output),
            }
        )
        audit.append(row)
        return diagnostic, audit
    return {
        "observableStatus": "unknown",
        "quantitativeResults": [],
        "boundary": (
            "No verified, event-matched IRIS Level-2 spectroscopy supplement is registered "
            "for this case."
        ),
    }, audit


def sharp_segment_data(path: Path) -> np.ndarray:
    with fits.open(path, memmap=False, do_not_scale_image_data=False) as hdus:
        for hdu in hdus:
            data = getattr(hdu, "data", None)
            if data is not None and np.ndim(data) >= 2:
                result = np.asarray(data, dtype=np.float32)
                while result.ndim > 2:
                    result = result[0]
                return result
    raise ValueError(f"no SHARP image HDU in {path}")


def process_vector_case(vector_manifest: dict | None, root: Path, case_id: str) -> dict:
    if not vector_manifest:
        return {
            "usable": False,
            "reason": "verified hmi.sharp_cea_720s supplement is unavailable",
        }
    case = next(
        (item for item in vector_manifest.get("cases", []) if item.get("caseId") == case_id),
        None,
    )
    if not case:
        return {"usable": False, "reason": f"no SHARP mapping for {case_id}"}
    assets = {item["assetId"]: item for item in vector_manifest.get("assets", [])}
    records = evenly_spaced(case.get("records", []), MAX_SERIES_FRAMES)
    times: list[float] = []
    unsigned_flux: list[float] = []
    horizontal_field: list[float] = []
    unsigned_current: list[float] = []
    current_helicity: list[float] = []
    horizontal_energy_surface_proxy: list[float] = []
    component_error: list[float] = []
    valid_fraction: list[float] = []
    failures: list[str] = []
    sampled_checksums: dict[str, str] = {}
    mu0 = 4.0 * math.pi * 1e-7
    for record in records:
        try:
            arrays: dict[str, np.ndarray] = {}
            for segment, asset_id in record["segmentAssetIds"].items():
                asset = assets[asset_id]
                path = root / asset["relativePath"]
                actual = sha256(path)
                if actual.lower() != str(asset.get("sha256", "")).lower():
                    raise ValueError(f"checksum mismatch for {asset_id}")
                if len(sampled_checksums) < 24:
                    sampled_checksums[asset_id] = actual
                arrays[segment] = sharp_segment_data(path)
            common_y = min(value.shape[0] for value in arrays.values())
            common_x = min(value.shape[1] for value in arrays.values())
            arrays = {
                key: value[:common_y, :common_x].astype(float, copy=False)
                for key, value in arrays.items()
            }
            br, bt, bp = arrays["Br"], arrays["Bt"], arrays["Bp"]
            confidence = arrays["conf_disambig"]
            finite = np.isfinite(br) & np.isfinite(bt) & np.isfinite(bp)
            mask = finite & (confidence >= 60) & (np.sqrt(br * br + bt * bt + bp * bp) <= 5000)
            if np.sum(mask) < 100:
                raise ValueError("fewer than 100 high-confidence vector pixels")
            keyword = record.get("keywords", {})
            rsun_m = float(numeric_keyword(keyword.get("RSUN_REF")) or 6.96e8)
            cdelt1_deg = abs(float(numeric_keyword(keyword.get("CDELT1")) or 0.03))
            cdelt2_deg = abs(float(numeric_keyword(keyword.get("CDELT2")) or 0.03))
            dx_m = rsun_m * math.radians(cdelt1_deg)
            dy_m = rsun_m * math.radians(cdelt2_deg)
            pixel_area_cm2 = dx_m * dy_m * 1e4
            pixel_area_m2 = dx_m * dy_m
            bh = np.sqrt(bt * bt + bp * bp)
            d_bp_dx = np.gradient(bp * 1e-4, dx_m, axis=1)
            d_minus_bt_dy = np.gradient(-bt * 1e-4, dy_m, axis=0)
            jz = (d_bp_dx - d_minus_bt_dy) / mu0
            unsigned_flux.append(float(np.sum(np.abs(br[mask])) * pixel_area_cm2))
            horizontal_field.append(float(np.median(bh[mask])))
            unsigned_current.append(float(np.sum(np.abs(jz[mask])) * pixel_area_m2))
            current_helicity.append(float(np.mean((br[mask] * 1e-4) * jz[mask])))
            horizontal_energy_surface_proxy.append(
                float(np.sum((bh[mask] ** 2) / (8.0 * math.pi)) * pixel_area_cm2)
            )
            error_stack = np.sqrt(
                arrays["Br_err"] ** 2
                + arrays["Bt_err"] ** 2
                + arrays["Bp_err"] ** 2
            )
            component_error.append(float(np.nanmedian(error_stack[mask])))
            valid_fraction.append(float(np.mean(mask)))
            times.append(iso_seconds(record["observedAt"]))
        except Exception as error:
            failures.append(f"{record.get('recordId', 'unknown')}: {error}")
    if len(times) < 4:
        return {
            "usable": False,
            "reason": "fewer than four readable SHARP vector records",
            "readFailures": failures[:30],
        }

    def slope(values: list[float]) -> float:
        return float(
            np.polyfit(np.asarray(times) - times[0], np.asarray(values, dtype=float), 1)[0]
            * 3600.0
        )

    return {
        "usable": True,
        "sourceSeries": "hmi.sharp_cea_720s",
        "harpNum": str(case.get("harpNum")),
        "recordCount": len(times),
        "requestedRecordCount": len(records),
        "epochSeconds": times,
        "unsignedRadialFluxMx": unsigned_flux,
        "unsignedRadialFluxMedianMx": float(np.median(unsigned_flux)),
        "unsignedRadialFluxSlopeMxPerHour": slope(unsigned_flux),
        "unsignedRadialFluxSlopeIntervalMxPerHour": deterministic_slope_interval(
            times, unsigned_flux
        ),
        "horizontalFieldMedianG": float(np.median(horizontal_field)),
        "horizontalFieldG": horizontal_field,
        "horizontalFieldSlopeGPerHour": slope(horizontal_field),
        "totalUnsignedVerticalCurrentMedianA": float(np.median(unsigned_current)),
        "totalUnsignedVerticalCurrentA": unsigned_current,
        "totalUnsignedVerticalCurrentSlopeAPerHour": slope(unsigned_current),
        "totalUnsignedVerticalCurrentSlopeIntervalAPerHour": deterministic_slope_interval(
            times, unsigned_current
        ),
        "meanCurrentHelicityDensityMedianTeslaAPerM2": float(
            np.median(current_helicity)
        ),
        "horizontalMagneticEnergySurfaceProxyMedianErgPerCm": float(
            np.median(horizontal_energy_surface_proxy)
        ),
        "componentErrorMedianG": float(np.median(component_error)),
        "highConfidencePixelFractionMedian": float(np.median(valid_fraction)),
        "sampledChecksums": sampled_checksums,
        "readFailures": failures[:30],
        "boundary": (
            "SHARP CEA 提供光球矢量磁场、电流和能量面密度代理；"
            "未做势场/非线性无力场外推，因此不得称为日冕自由能或重联率。"
        ),
    }


def process_case(
    manifest: dict,
    root: Path,
    case: dict,
    limit: int,
    cache_dir: Path,
    preprocessing_stats: dict,
    metadata_supplements: dict[str, dict],
    roi: dict | None = None,
) -> dict:
    assets = {item["assetId"]: item for item in manifest["assets"]}
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for observation in case["observations"]:
        band = observation.get("wavelengthOrBand") or "HMI"
        grouped[(observation["streamId"], band)].append(observation)
    for observations in grouped.values():
        observations.sort(key=lambda item: item["observedAt"])

    reference_key = next(
        (key for key in grouped if key[1] == "193 Å" and "core" in key[0]),
        next((key for key in grouped if key[1] == "193 Å"), None),
    )
    if reference_key is None:
        raise ValueError(f"case {case['caseId']} has no AIA 193A reference")
    reference_observations = evenly_spaced(grouped[reference_key], min(limit, 12))
    reference_frames = []
    reference_metadata_rows = []
    file_metadata: dict[str, dict] = {}
    used: list[dict] = []
    failures: list[str] = []
    for observation in reference_observations:
        asset = assets[observation["assetId"]]
        if not has_acceptable_quality(asset, observation):
            preprocessing_stats["qualityRejectedFrames"] += 1
            failures.append(f"{observation['assetId']}: non-zero QUALITY flag")
            continue
        path = root / asset["relativePath"]
        try:
            frame, metadata = reduced_frame(
                path,
                asset,
                cache_dir,
                preprocessing_stats,
                metadata_supplements.get(str(asset.get("assetId"))),
            )
            reference_frames.append(frame)
            reference_metadata_rows.append(metadata)
            file_metadata[observation["assetId"]] = metadata
        except Exception as error:
            failures.append(f"{observation['assetId']}: {error}")
    if len(reference_frames) < 3:
        raise ValueError(f"case {case['caseId']} has fewer than three readable 193A frames")
    reference_metadata = next(
        (metadata for metadata in reference_metadata_rows if has_linear_wcs(metadata.get("reducedWcs", {}))),
        reference_metadata_rows[0],
    )
    reference_shape = tuple(int(value) for value in reference_metadata["reducedShape"])
    aligned_reference_frames = []
    for frame, metadata in zip(reference_frames, reference_metadata_rows):
        try:
            aligned_reference_frames.append(
                reproject_frame(
                    frame,
                    metadata.get("reducedWcs", {}),
                    reference_metadata.get("reducedWcs", {}),
                    reference_shape,
                    source_date=metadata.get("dateObs"),
                    reference_date=reference_metadata.get("dateObs"),
                )
            )
        except Exception:
            aligned_reference_frames.append(frame[: reference_shape[0], : reference_shape[1]])
    selected_roi = roi or attach_roi_world_metadata(
        select_roi(aligned_reference_frames), reference_metadata
    )

    channels: dict[str, dict] = {}
    sampled_assets: dict[str, str] = {}
    alignment_counts = {"aiaRegistered": 0, "aiaFallback": 0, "hmiRegistered": 0, "hmiUnregistered": 0}
    rotation_shift_pixels: list[float] = []
    rotation_failures: list[str] = []
    for (stream, band), observations in sorted(grouped.items()):
        # The starter pack is already bounded (at most 80 frames per stream),
        # so use every registered frame for the scientific time series. The
        # cap protects future, much larger manifests without reverting to the
        # previous 12/18-frame under-sampling policy.
        selected = evenly_spaced(observations, MAX_SERIES_FRAMES)
        times: list[float] = []
        values: list[float] = []
        absolute_values: list[float] = []
        signed_values: list[float] = []
        gradient_values: list[float] = []
        pil_values: list[float] = []
        magnetic_times: list[float] = []
        signed_flux_values: list[float] = []
        unsigned_flux_values: list[float] = []
        physical_gradient_values: list[float] = []
        pil_length_values: list[float] = []
        pil_field_values: list[float] = []
        physical_units: set[str] = set()
        spatial_times: list[float] = []
        spatial_frames: list[np.ndarray] = []
        for observation in selected:
            asset = assets[observation["assetId"]]
            if not has_acceptable_quality(asset, observation):
                preprocessing_stats["qualityRejectedFrames"] += 1
                failures.append(f"{observation['assetId']}: non-zero QUALITY flag")
                continue
            path = root / asset["relativePath"]
            try:
                frame, metadata = reduced_frame(
                    path,
                    asset,
                    cache_dir,
                    preprocessing_stats,
                    metadata_supplements.get(str(asset.get("assetId"))),
                )
                crop, registered = aligned_crop(frame, metadata, selected_roi)
                rotation = metadata.get("differentialRotation", {})
                if rotation.get("applied"):
                    shift = rotation.get("centerShiftPixels", [0.0, 0.0])
                    rotation_shift_pixels.append(float(np.hypot(float(shift[0]), float(shift[1]))))
                if rotation.get("error"):
                    rotation_failures.append(str(rotation["error"]))
                registered = bool(
                    registered and crop.size > 0 and np.isfinite(crop).sum() / crop.size >= 0.8
                )
                finite = crop[np.isfinite(crop)]
                if finite.size == 0:
                    raise ValueError("ROI has no finite pixels")
                if observation["instrument"] == "SDO/HMI":
                    alignment_counts["hmiRegistered" if registered else "hmiUnregistered"] += 1
                    value = float(np.nanmean(np.abs(finite)))
                    absolute_values.append(float(np.nanpercentile(np.abs(finite), 95)))
                    spatial = magnetic_spatial_metrics(
                        crop, selected_roi.get("referenceWcs", {}), metadata
                    )
                    if spatial.get("usable"):
                        signed_values.append(float(spatial["signedMeanProxy"]))
                        gradient_values.append(float(spatial["gradientMedianProxy"]))
                        pil_values.append(float(spatial["pilNeighborhoodFractionProxy"]))
                    if registered and spatial.get("physicalUsable"):
                        magnetic_times.append(iso_seconds(observation["observedAt"]))
                        signed_flux_values.append(float(spatial["signedLosFluxMx"]))
                        unsigned_flux_values.append(float(spatial["unsignedLosFluxMx"]))
                        physical_gradient_values.append(float(spatial["gradientMedianGPerMm"]))
                        pil_length_values.append(float(spatial["pilLengthProxyMm"]))
                        pil_field_values.append(float(spatial["pilNeighborhoodMeanAbsFieldG"]))
                    bunit = metadata.get("reducedWcs", {}).get("BUNIT")
                    if bunit:
                        physical_units.add(str(bunit))
                else:
                    alignment_counts["aiaRegistered" if registered else "aiaFallback"] += 1
                    value = float(np.nanmedian(finite))
                    if registered and band in ("171 Å", "193 Å"):
                        spatial_times.append(iso_seconds(observation["observedAt"]))
                        spatial_frames.append(np.asarray(crop, dtype=np.float32))
                times.append(iso_seconds(observation["observedAt"]))
                values.append(value)
                file_metadata[observation["assetId"]] = metadata
                used.append(observation)
                if len(sampled_assets) < 24:
                    actual = sha256(path)
                    sampled_assets[observation["assetId"]] = actual
                    if actual.lower() != str(asset.get("sha256", "")).lower():
                        failures.append(f"{observation['assetId']}: checksum mismatch")
            except Exception as error:
                failures.append(f"{observation['assetId']}: {error}")
        cadence = float(selected[0].get("cadenceSeconds", 0)) if selected else 0.0
        metrics = series_metrics(times, values, cadence)
        metrics.update({
            "streamId": stream,
            "band": band,
            "instrument": selected[0]["instrument"] if selected else "unknown",
            "readableCount": len(values),
            "requestedCount": len(selected),
            "availableCount": len(observations),
            "selectionPolicy": f"all frames up to {MAX_SERIES_FRAMES}; evenly spaced above cap",
            "p95AbsMedian": float(np.nanmedian(absolute_values)) if absolute_values else None,
            "signedMeanProxyMedian": float(np.nanmedian(signed_values)) if signed_values else None,
            "signedMeanProxySlopePerHour": (
                float(np.polyfit(np.asarray(times) - times[0], signed_values, 1)[0] * 3600.0)
                if len(signed_values) == len(times) and len(times) >= 4
                else None
            ),
            "gradientMedianProxy": float(np.nanmedian(gradient_values)) if gradient_values else None,
            "pilNeighborhoodFractionProxy": float(np.nanmedian(pil_values)) if pil_values else None,
            "physicalMagneticUsable": bool(
                len(magnetic_times) == len(values) and len(magnetic_times) >= 4
            ),
            "signedLosFluxMedianMx": (
                float(np.nanmedian(signed_flux_values)) if signed_flux_values else None
            ),
            "signedLosFluxSlopeMxPerHour": (
                float(
                    np.polyfit(
                        np.asarray(magnetic_times) - magnetic_times[0], signed_flux_values, 1
                    )[0]
                    * 3600.0
                )
                if len(magnetic_times) >= 4
                else None
            ),
            "signedLosFluxSlopeIntervalMxPerHour": deterministic_slope_interval(
                magnetic_times, signed_flux_values
            ),
            "unsignedLosFluxMedianMx": (
                float(np.nanmedian(unsigned_flux_values)) if unsigned_flux_values else None
            ),
            "unsignedLosFluxSlopeMxPerHour": (
                float(
                    np.polyfit(
                        np.asarray(magnetic_times) - magnetic_times[0], unsigned_flux_values, 1
                    )[0]
                    * 3600.0
                )
                if len(magnetic_times) >= 4
                else None
            ),
            "unsignedLosFluxSlopeIntervalMxPerHour": deterministic_slope_interval(
                magnetic_times, unsigned_flux_values
            ),
            "gradientMedianGPerMm": (
                float(np.nanmedian(physical_gradient_values))
                if physical_gradient_values
                else None
            ),
            "pilLengthMedianMm": (
                float(np.nanmedian(pil_length_values)) if pil_length_values else None
            ),
            "pilNeighborhoodMeanAbsFieldG": (
                float(np.nanmedian(pil_field_values)) if pil_field_values else None
            ),
            "spatialRegistrationAvailable": bool(
                selected and selected[0]["instrument"] != "SDO/HMI"
                or alignment_counts["hmiRegistered"] > 0
            ),
            "physicalUnitMetadata": sorted(physical_units),
        })
        if spatial_frames:
            metrics["spatialWave"] = spatial_wave_metrics(
                spatial_times,
                spatial_frames,
                selected_roi.get("referenceWcs", {}),
            )
        channels[f"{stream}:{band}"] = metrics

    def channel(band: str, contains: str | None = None) -> dict | None:
        candidates = [value for key, value in channels.items() if key.endswith(f":{band}")]
        if contains:
            candidates = [value for value in candidates if contains in value["streamId"]]
        return max(candidates, key=lambda item: item.get("count", 0), default=None)

    comparisons = {
        "burst171_193": correlation_metrics(
            channel("171 Å", "burst") or channel("171 Å"),
            channel("193 Å", "burst") or channel("193 Å"),
        ),
        "core94_131": correlation_metrics(channel("94 Å"), channel("131 Å")),
    }
    aia_registration_ready = alignment_counts["aiaRegistered"] > 0 and alignment_counts["aiaFallback"] == 0
    hmi_registration_ready = alignment_counts["hmiRegistered"] > 0 and alignment_counts["hmiUnregistered"] == 0
    return {
        "caseId": case["caseId"],
        "label": case["label"],
        "activeRegion": case["activeRegion"],
        "role": case.get("role"),
        "backgroundFor": case.get("backgroundFor"),
        "roi": selected_roi,
        "channels": channels,
        "comparisons": comparisons,
        "alignment": {
            **alignment_counts,
            "aiaWcsRegistrationReady": aia_registration_ready,
            "hmiWcsRegistrationReady": hmi_registration_ready,
            "unifiedRoiReferenceBand": "193 Å",
            "roiCoordinateSystem": "helioprojective WCS" if aia_registration_ready else "normalized pixel fallback",
            "differentialRotation": {
                "model": DIFFERENTIAL_ROTATION_MODEL,
                "appliedFrameCount": len(rotation_shift_pixels),
                "medianCenterShiftPixels": (
                    float(np.median(rotation_shift_pixels)) if rotation_shift_pixels else 0.0
                ),
                "maxCenterShiftPixels": (
                    float(np.max(rotation_shift_pixels)) if rotation_shift_pixels else 0.0
                ),
                "failureCount": len(rotation_failures),
                "failures": rotation_failures[:5],
                "approximation": "local tangent-plane translation followed by WCS reprojection",
            },
        },
        "usedObservationCount": len(used),
        "sampleIds": list(dict.fromkeys(item["logicalId"] for item in used)),
        "sampledChecksums": sampled_assets,
        "readFailures": failures[:30],
    }


def spatial_wave_diagnostic(channels: dict[str, dict]) -> dict:
    rows = []
    for band in ("171 Å", "193 Å"):
        candidates = [
            value
            for key, value in channels.items()
            if key.endswith(f":{band}") and value.get("spatialWave", {}).get("usable")
        ]
        burst = [value for value in candidates if "burst" in str(value.get("streamId", ""))]
        selected = max(
            burst or candidates,
            key=lambda item: item.get("spatialWave", {}).get("frameCount", 0),
            default=None,
        )
        if selected:
            rows.append({"band": band, **selected["spatialWave"]})
    periods = [float(row["dominantPeriodSeconds"]) for row in rows]
    period_agreement = bool(
        len(periods) == 2 and max(periods) / max(min(periods), 1.0) <= 1.5
    )
    coherent_bands = [
        row for row in rows if row.get("spatialCoherenceObservableStatus") == "support"
    ]
    propagating_bands = [
        row for row in rows if row.get("propagationObservableStatus") == "support"
    ]
    support = bool(
        period_agreement and (len(coherent_bands) == 2 or len(propagating_bands) == 2)
    )
    quantitative = []
    speeds = [
        row.get("propagation", {}).get("apparentPropagationSpeedKmPerSecond")
        for row in propagating_bands
        if row.get("propagation", {}).get("usable")
        and row.get("propagation", {}).get("apparentPropagationSpeedKmPerSecond") is not None
    ]
    if speeds:
        quantitative.append(
            {
                "metric": "aia_spatial_apparent_propagation_speed",
                "estimate": float(np.median(speeds)),
                "unit": "km/s",
            }
        )
    return {
        "observableStatus": "support" if support else "unknown",
        "usableBandCount": len(rows),
        "periodAgreement": period_agreement,
        "standingWaveCompatibleBandCount": len(coherent_bands),
        "propagationCompatibleBandCount": len(propagating_bands),
        "bands": rows,
        "quantitativeResults": quantitative,
        "boundary": (
            "空间相干、节点/反节点和表观传播均在自动 ROI 的降采样图像上计算；"
            "未做人工沿环追踪、密度测量或能流闭合，因此只检验波动预测相容性。"
        ),
    }


def vector_magnetic_diagnostic(target: dict) -> dict:
    vector = target.get("vectorMagnetic", {})
    if not vector.get("usable"):
        return {
            "observableStatus": "unknown",
            "usable": False,
            "reason": vector.get("reason", "SHARP vector data unavailable"),
            "quantitativeResults": [],
            "boundary": "没有通过校验的事件匹配 HMI SHARP CEA 矢量磁场记录。",
        }
    flux_median = float(vector.get("unsignedRadialFluxMedianMx", 0))
    flux_slope = float(vector.get("unsignedRadialFluxSlopeMxPerHour", 0))
    flux_interval = vector.get("unsignedRadialFluxSlopeIntervalMxPerHour")
    current_median = float(vector.get("totalUnsignedVerticalCurrentMedianA", 0))
    current_slope = float(vector.get("totalUnsignedVerticalCurrentSlopeAPerHour", 0))
    current_interval = vector.get("totalUnsignedVerticalCurrentSlopeIntervalAPerHour")
    resolved_flux = bool(
        flux_interval
        and flux_interval[0] * flux_interval[1] > 0
        and flux_median > 0
        and abs(flux_slope / flux_median) >= 0.005
    )
    resolved_current = bool(
        current_interval
        and current_interval[0] * current_interval[1] > 0
        and current_median > 0
        and abs(current_slope / current_median) >= 0.01
    )
    quantitative = []
    if flux_interval:
        quantitative.append(
            {
                "metric": "hmi_sharp_unsigned_radial_flux_slope",
                "estimate": flux_slope,
                "lowerBound": float(flux_interval[0]),
                "upperBound": float(flux_interval[1]),
                "confidenceLevel": 0.95,
                "unit": "Mx/hour",
            }
        )
    if current_interval:
        quantitative.append(
            {
                "metric": "hmi_sharp_total_unsigned_vertical_current_slope",
                "estimate": current_slope,
                "lowerBound": float(current_interval[0]),
                "upperBound": float(current_interval[1]),
                "confidenceLevel": 0.95,
                "unit": "A/hour",
            }
        )
    return {
        "observableStatus": "support" if resolved_flux or resolved_current else "unknown",
        "usable": True,
        "recordCount": vector.get("recordCount"),
        "harpNum": vector.get("harpNum"),
        "resolvedRadialFluxEvolution": resolved_flux,
        "resolvedUnsignedCurrentEvolution": resolved_current,
        "unsignedRadialFluxMedianMx": flux_median,
        "horizontalFieldMedianG": vector.get("horizontalFieldMedianG"),
        "totalUnsignedVerticalCurrentMedianA": current_median,
        "meanCurrentHelicityDensityMedianTeslaAPerM2": vector.get(
            "meanCurrentHelicityDensityMedianTeslaAPerM2"
        ),
        "horizontalMagneticEnergySurfaceProxyMedianErgPerCm": vector.get(
            "horizontalMagneticEnergySurfaceProxyMedianErgPerCm"
        ),
        "componentErrorMedianG": vector.get("componentErrorMedianG"),
        "highConfidencePixelFractionMedian": vector.get(
            "highConfidencePixelFractionMedian"
        ),
        "quantitativeResults": quantitative,
        "boundary": vector.get("boundary"),
    }


def magnetic_thermal_association_diagnostic(target: dict) -> dict:
    vector = target.get("vectorMagnetic", {})
    events = merged_hot_events(target.get("channels", {}))
    times = np.asarray(vector.get("epochSeconds", []), dtype=float)
    flux = np.asarray(vector.get("unsignedRadialFluxMx", []), dtype=float)
    if not vector.get("usable") or len(events) < 3 or len(times) < 6 or len(times) != len(flux):
        return {
            "observableStatus": "unknown",
            "usable": False,
            "eventCount": len(events),
            "vectorRecordCount": int(len(times)),
            "quantitativeResults": [],
            "boundary": (
                "磁—热时序关联至少需要 3 个热事件和 6 条通过校验的 SHARP 矢量记录；"
                "即使相关也不能单独建立磁重联因果。"
            ),
        }
    order = np.argsort(times)
    times, flux = times[order], flux[order]
    log_flux = np.log(np.maximum(flux, 1e-12))
    derivative_times = (times[1:] + times[:-1]) / 2.0
    relative_rate_per_hour = np.diff(log_flux) / np.diff(times) * 3600.0
    event_times = np.asarray([row["peakEpoch"] for row in events], dtype=float)

    def association(candidate_times: np.ndarray) -> tuple[float, float]:
        indices = np.asarray(
            [int(np.argmin(np.abs(derivative_times - value))) for value in candidate_times]
        )
        distances = np.asarray(
            [derivative_times[index] - value for index, value in zip(indices, candidate_times, strict=True)]
        )
        return float(np.mean(np.abs(relative_rate_per_hour[indices]))), float(
            np.median(distances)
        )

    observed, median_lag = association(event_times)
    window = max(float(times[-1] - times[0]), 1.0)
    seed = int(
        hashlib.sha256(
            np.concatenate([times, flux, event_times]).astype("<f8").tobytes()
        ).hexdigest()[:16],
        16,
    )
    rng = np.random.default_rng(seed)
    null = []
    for _ in range(399):
        offset = float(rng.uniform(0.1 * window, 0.9 * window))
        shifted = times[0] + np.mod(event_times - times[0] + offset, window)
        null.append(association(shifted)[0])
    p_value = float((1 + sum(value >= observed for value in null)) / (1 + len(null)))
    support = bool(
        p_value <= 0.05
        and abs(median_lag) <= 2.0 * float(np.median(np.diff(times)))
    )
    return {
        "observableStatus": "support" if support else "unknown",
        "usable": True,
        "eventCount": len(events),
        "vectorRecordCount": len(times),
        "meanAbsoluteUnsignedFluxFractionalRateAtEventsPerHour": observed,
        "medianMagneticDerivativeMinusHotPeakLagSeconds": median_lag,
        "circularShiftPValue": p_value,
        "quantitativeResults": [
            {
                "metric": "hmi_sharp_hot_event_flux_rate_association",
                "estimate": observed,
                "unit": "1/hour",
            }
        ],
        "boundary": (
            "该检验使用热峰附近的 SHARP 无符号径向磁通变化率与循环移位零分布；"
            "时间相关不等于重联率或因果方向，且 720 秒 cadence 限制起始时刻精度。"
        ),
    }


def diagnostic_summary(target: dict, baseline: dict | None) -> dict:
    channels = target["channels"]

    def best(band: str, stream: str | None = None) -> dict | None:
        candidates = [value for key, value in channels.items() if key.endswith(f":{band}")]
        if stream:
            candidates = [value for value in candidates if stream in value["streamId"]]
        return max(candidates, key=lambda item: item.get("count", 0), default=None)

    wave_a = best("171 Å", "burst") or best("171 Å")
    wave_b = best("193 Å", "burst") or best("193 Å")
    wave_corr = target["comparisons"]["burst171_193"]
    periods = [item.get("dominantPeriodSeconds") for item in (wave_a, wave_b) if item]
    periods = [float(value) for value in periods if value is not None]
    period_agreement = len(periods) == 2 and max(periods) / max(min(periods), 1.0) <= 1.5
    wave_duration = min(
        [float(item.get("durationSeconds", 0)) for item in (wave_a, wave_b) if item],
        default=0.0,
    )
    cycles_covered = wave_duration / max(periods) if periods and max(periods) > 0 else 0.0
    period_resolved = bool(period_agreement and cycles_covered >= 2.0)
    wave_support = bool(
        wave_corr.get("usable")
        and wave_corr.get("correlation", 0) >= 0.35
        and period_resolved
        and all((item or {}).get("spectralSnr", 0) >= 2.5 for item in (wave_a, wave_b))
    )

    hot94, hot131 = best("94 Å"), best("131 Å")
    hmi = next((value for value in channels.values() if value.get("instrument") == "SDO/HMI"), None)
    hot_peaks = int((hot94 or {}).get("peakCount", 0) + (hot131 or {}).get("peakCount", 0))
    hot_peak_sensitivity = {
        f"{threshold:.2f}": int(
            (hot94 or {}).get("peakCountSensitivity", {}).get(f"{threshold:.2f}", 0)
            + (hot131 or {}).get("peakCountSensitivity", {}).get(f"{threshold:.2f}", 0)
        )
        for threshold in PEAK_PROMINENCE_GRID
    }
    hot_peak_counts = list(hot_peak_sensitivity.values())
    hot_peak_detection_stable = bool(
        hot_peak_counts
        and min(hot_peak_counts) >= 2
        and max(hot_peak_counts) - min(hot_peak_counts) <= 2
    )
    hot_variability = float(np.nanmean([
        (hot94 or {}).get("relativeVariability", np.nan),
        (hot131 or {}).get("relativeVariability", np.nan),
    ]))
    hot_intervals = [
        item.get("relativeVariabilityInterval")
        for item in (hot94, hot131)
        if item and item.get("relativeVariabilityInterval")
    ]
    hot_variability_interval = (
        [
            float(np.mean([interval[0] for interval in hot_intervals])),
            float(np.mean([interval[1] for interval in hot_intervals])),
        ]
        if len(hot_intervals) == 2
        else None
    )
    baseline_ratio = None
    baseline_ratio_interval = None
    if baseline:
        baseline_hot = [
            value.get("relativeVariability", np.nan)
            for key, value in baseline["channels"].items()
            if key.endswith(":94 Å") or key.endswith(":131 Å")
        ]
        base_value = float(np.nanmean(baseline_hot)) if baseline_hot else float("nan")
        if np.isfinite(base_value) and base_value > 0 and np.isfinite(hot_variability):
            baseline_ratio = float(hot_variability / base_value)
            baseline_intervals = [
                value.get("relativeVariabilityInterval")
                for key, value in baseline["channels"].items()
                if (key.endswith(":94 Å") or key.endswith(":131 Å"))
                and value.get("relativeVariabilityInterval")
            ]
            if hot_variability_interval and len(baseline_intervals) == 2:
                base_lower = float(np.mean([interval[0] for interval in baseline_intervals]))
                base_upper = float(np.mean([interval[1] for interval in baseline_intervals]))
                if base_lower > 0 and base_upper > 0:
                    candidate_interval = [
                        float(hot_variability_interval[0] / base_upper),
                        float(hot_variability_interval[1] / base_lower),
                    ]
                    # A near-zero background makes the ratio effectively
                    # unidentified. Do not publish an enormous formal interval
                    # as if it were useful quantitative evidence.
                    if candidate_interval[1] <= max(20.0, baseline_ratio * 20.0):
                        baseline_ratio_interval = candidate_interval

    reconnection_support = bool(
        hot_peaks >= 2
        and hot_peak_detection_stable
        and np.isfinite(hot_variability)
        and hot_variability_interval
        and hot_variability_interval[0] >= 0.02
        and baseline_ratio_interval
        and baseline_ratio_interval[0] > 1.0
    )

    wave_quantitative = []
    correlation_interval = wave_corr.get("correlationInterval")
    correlation_estimate = wave_corr.get("correlation")
    if correlation_interval and correlation_estimate is not None:
        wave_quantitative.append({
            "metric": "aia_171_193_selected_lag_correlation",
            "estimate": float(correlation_estimate),
            "lowerBound": float(correlation_interval[0]),
            "upperBound": float(correlation_interval[1]),
            "confidenceLevel": 0.95,
            "unit": "1",
        })

    reconnection_quantitative = []
    if hot_variability_interval and np.isfinite(hot_variability):
        reconnection_quantitative.append({
            "metric": "aia_94_131_relative_variability",
            "estimate": hot_variability,
            "lowerBound": float(hot_variability_interval[0]),
            "upperBound": float(hot_variability_interval[1]),
            "confidenceLevel": 0.95,
            "unit": "1",
        })
    if baseline_ratio is not None and baseline_ratio_interval:
        reconnection_quantitative.append({
            "metric": "target_to_background_hot_channel_variability_ratio",
            "estimate": baseline_ratio,
            "lowerBound": float(baseline_ratio_interval[0]),
            "upperBound": float(baseline_ratio_interval[1]),
            "confidenceLevel": 0.95,
            "unit": "ratio",
        })

    cooling = cooling_sequence_diagnostic(channels)
    dem_temperature = dem_temperature_diagnostic(channels)
    spatial_wave = spatial_wave_diagnostic(channels)
    event_fluence_distribution = event_fluence_distribution_diagnostic(target, baseline)
    vector_magnetic_evolution = vector_magnetic_diagnostic(target)
    magnetic_thermal_association = magnetic_thermal_association_diagnostic(target)
    hmi_wcs_ready = bool(target.get("alignment", {}).get("hmiWcsRegistrationReady"))
    hmi_units = list((hmi or {}).get("physicalUnitMetadata", []))
    hmi_physical_ready = bool((hmi or {}).get("physicalMagneticUsable"))
    magnetic_quantitative = []
    signed_flux_slope = (hmi or {}).get("signedLosFluxSlopeMxPerHour")
    signed_flux_interval = (hmi or {}).get("signedLosFluxSlopeIntervalMxPerHour")
    unsigned_flux_slope = (hmi or {}).get("unsignedLosFluxSlopeMxPerHour")
    unsigned_flux_interval = (hmi or {}).get("unsignedLosFluxSlopeIntervalMxPerHour")
    unsigned_flux_median = (hmi or {}).get("unsignedLosFluxMedianMx")
    resolved_flux_evolution = bool(
        unsigned_flux_slope is not None
        and unsigned_flux_interval
        and unsigned_flux_median
        and unsigned_flux_interval[0] * unsigned_flux_interval[1] > 0
        and abs(float(unsigned_flux_slope) / float(unsigned_flux_median)) >= 0.005
    )
    if signed_flux_slope is not None and signed_flux_interval:
        magnetic_quantitative.append({
            "metric": "hmi_projected_signed_los_flux_slope",
            "estimate": float(signed_flux_slope),
            "lowerBound": float(signed_flux_interval[0]),
            "upperBound": float(signed_flux_interval[1]),
            "confidenceLevel": 0.95,
            "unit": "Mx/hour",
        })
    if unsigned_flux_slope is not None and unsigned_flux_interval:
        magnetic_quantitative.append({
            "metric": "hmi_projected_unsigned_los_flux_slope",
            "estimate": float(unsigned_flux_slope),
            "lowerBound": float(unsigned_flux_interval[0]),
            "upperBound": float(unsigned_flux_interval[1]),
            "confidenceLevel": 0.95,
            "unit": "Mx/hour",
        })
    magnetic = {
        "observableStatus": (
            "support"
            if hmi_wcs_ready and hmi_physical_ready and resolved_flux_evolution
            else "unknown"
        ),
        "wcsRegistrationAvailable": hmi_wcs_ready,
        "physicalUnitMetadataAvailable": bool(hmi_units),
        "physicalMagneticMetricsAvailable": hmi_physical_ready,
        "resolvedFluxEvolution": resolved_flux_evolution,
        "frozenCriterion": "95% moving-block interval for unsigned LOS-flux slope excludes zero and |slope/median flux| >= 0.5% per hour",
        "signedMeanProxySlopePerHour": (hmi or {}).get("signedMeanProxySlopePerHour"),
        "unsignedMeanProxySlopePerHour": (hmi or {}).get("linearSlopePerHour"),
        "gradientMedianProxy": (hmi or {}).get("gradientMedianProxy"),
        "pilNeighborhoodFractionProxy": (hmi or {}).get("pilNeighborhoodFractionProxy"),
        "signedLosFluxMedianMx": (hmi or {}).get("signedLosFluxMedianMx"),
        "signedLosFluxSlopeMxPerHour": signed_flux_slope,
        "signedLosFluxSlopeIntervalMxPerHour": signed_flux_interval,
        "unsignedLosFluxMedianMx": unsigned_flux_median,
        "unsignedLosFluxSlopeMxPerHour": unsigned_flux_slope,
        "unsignedLosFluxSlopeIntervalMxPerHour": unsigned_flux_interval,
        "gradientMedianGPerMm": (hmi or {}).get("gradientMedianGPerMm"),
        "pilLengthMedianMm": (hmi or {}).get("pilLengthMedianMm"),
        "pilNeighborhoodMeanAbsFieldG": (hmi or {}).get("pilNeighborhoodMeanAbsFieldG"),
        "quantitativeResults": magnetic_quantitative,
        "boundary": (
            "HMI 记录元数据或共空间配准不完整，只保留像素空间审计代理。"
            if not hmi_wcs_ready or not hmi_physical_ready
            else "已报告共空间 ROI 的投影视向磁通、梯度与 PIL 长度；未进行径向场反投影、矢量磁场反演或自由磁能估计，不能单独证明磁重联加热。"
        ),
    }

    return {
        "wave": {
            "observableStatus": "support" if wave_support else "unknown",
            "periodAgreement": period_agreement,
            "periodResolved": period_resolved,
            "cyclesCovered": cycles_covered,
            "periodsSeconds": periods,
            "crossChannelCorrelation": wave_corr.get("correlation"),
            "crossChannelLagSeconds": wave_corr.get("lagSeconds"),
            "quantitativeResults": wave_quantitative,
            "boundary": "积分强度周期不是传播速度或能流测量，不能单独证明波动加热。",
        },
        "reconnection": {
            "observableStatus": "support" if reconnection_support else "unknown",
            "hotChannelPeakCount": hot_peaks,
            "eventThresholdSensitivity": {
                "prominenceGrid": list(PEAK_PROMINENCE_GRID),
                "combinedHotChannelPeakCounts": hot_peak_sensitivity,
                "stable": hot_peak_detection_stable,
                "frozenCriterion": "all thresholds detect >=2 peaks and total count range <=2",
            },
            "hotChannelRelativeVariability": hot_variability if np.isfinite(hot_variability) else None,
            "magneticProxySlopePerHour": float((hmi or {}).get("linearSlopePerHour", 0)),
            "targetToBackgroundVariabilityRatio": baseline_ratio,
            "targetToBackgroundVariabilityRatioInterval": baseline_ratio_interval,
            "quantitativeResults": reconnection_quantitative,
            "boundary": "热通道间歇性和 HMI 代理量不是重联或纳耀斑的唯一指纹。",
        },
        "coupled": {
            "observableStatus": "unknown",
            "jointIndicatorsPresent": bool(wave_support and reconnection_support),
            "quantitativeResults": wave_quantitative + reconnection_quantitative,
            "boundary": "联合时序特征不能建立能量分配比例或因果耦合。",
        },
        "cooling_sequence": cooling,
        "dem_temperature": dem_temperature,
        "magnetic_evolution": magnetic,
        "spatial_wave": spatial_wave,
        "event_fluence_distribution": event_fluence_distribution,
        "vector_magnetic_evolution": vector_magnetic_evolution,
        "magnetic_thermal_association": magnetic_thermal_association,
    }


def plot_result(target: dict, baseline: dict | None, path: Path) -> None:
    fig, axes = plt.subplots(2, 1, figsize=(10, 7), constrained_layout=True)
    colors = {"94 Å": "#dc5a3f", "131 Å": "#8b5cf6", "171 Å": "#2a9d8f", "193 Å": "#3a6ea5"}
    for key, metrics in target["channels"].items():
        band = metrics.get("band")
        if band not in colors or not metrics.get("usable"):
            continue
        times = np.asarray(metrics["timesSeconds"]) / 60.0
        values = robust_z(np.asarray(metrics["values"]))
        axes[0].plot(times, values, marker="o", markersize=2.5, linewidth=1.1, label=key, color=colors[band], alpha=0.85)
    axes[0].set_title(f"{target['caseId']} - normalized ROI intensity")
    axes[0].set_xlabel("minutes from first selected frame")
    axes[0].set_ylabel("robust z-score")
    axes[0].grid(alpha=0.2)
    axes[0].legend(fontsize=7, ncol=2)

    labels, values = [], []
    for key, metrics in target["channels"].items():
        if metrics.get("band") in colors and metrics.get("usable"):
            labels.append(key.replace("aia-", ""))
            values.append(float(metrics.get("relativeVariability", 0)))
    axes[1].bar(np.arange(len(values)), values, color="#315b74")
    axes[1].set_xticks(np.arange(len(values)), labels, rotation=35, ha="right", fontsize=7)
    axes[1].set_ylabel("relative variability")
    axes[1].set_title("Channel variability in the same automatically selected ROI")
    axes[1].grid(axis="y", alpha=0.2)
    fig.savefig(path, dpi=160)
    plt.close(fig)


def preprocessing_summary(
    stats: dict, cache_dir: Path, manifest: dict, metadata_audit: list[dict]
) -> dict:
    referenced_raw_bytes = int(sum(stats["_sourcePaths"].values()))
    derived_bytes = int(sum(stats["_cachePaths"].values()))
    cache_files = list(cache_dir.glob("*/*.npz")) if cache_dir.exists() else []
    cache_total_bytes = int(sum(path.stat().st_size for path in cache_files if path.is_file()))
    dataset_raw_bytes = int(
        manifest.get("plannedTotalBytes")
        or sum(int(asset.get("bytes", 0)) for asset in manifest.get("assets", []))
    )
    supplemental_raw_bytes = int(manifest.get("supplementalBytes", 0))
    total_registered_raw_bytes = dataset_raw_bytes + supplemental_raw_bytes
    return {
        "version": PREPROCESSING_VERSION,
        "targetMaximumPixels": REDUCED_FRAME_TARGET,
        "method": "exposure normalization + deterministic stride reduction + checksummed JSOC metadata supplementation + AIA/HMI linear-WCS reprojection to a frozen 193A reference ROI + event-matched SHARP CEA vector diagnostics + finite-value mask",
        "cachePolicy": "content-addressed by preprocessing version, target size, raw SHA-256 and supplemental metadata digest",
        "requestedFrameLoads": int(stats["requestedFrameLoads"]),
        "cacheHits": int(stats["cacheHits"]),
        "cacheMisses": int(stats["cacheMisses"]),
        "cacheHitRate": (
            float(stats["cacheHits"] / stats["requestedFrameLoads"])
            if stats["requestedFrameLoads"]
            else 0.0
        ),
        "uniqueRawAssetsReferenced": len(stats["_sourcePaths"]),
        "referencedRawBytes": referenced_raw_bytes,
        "derivedBytesForReferencedAssets": derived_bytes,
        "derivedToReferencedRatio": (
            float(derived_bytes / referenced_raw_bytes) if referenced_raw_bytes else None
        ),
        "datasetRawBytes": dataset_raw_bytes,
        "datasetSupplementalRawBytes": supplemental_raw_bytes,
        "datasetTotalRegisteredRawBytes": total_registered_raw_bytes,
        "cacheEntryCount": len(cache_files),
        "cacheTotalBytes": cache_total_bytes,
        "cacheToDatasetRatio": (
            float(cache_total_bytes / dataset_raw_bytes) if dataset_raw_bytes else None
        ),
        "cacheReadFailures": stats["cacheReadFailures"][:20],
        "cacheWriteFailures": stats["cacheWriteFailures"][:20],
        "qualityPolicy": "reject registered non-zero QUALITY flags before pixel analysis",
        "qualityRejectedFrames": int(stats["qualityRejectedFrames"]),
        "wcsMetadataRetained": True,
        "wcsRegistrationImplemented": True,
        "metadataSupplements": metadata_audit,
        "lossy": True,
        "rawRetentionRequired": True,
        "suitableFor": [
            "bounded ROI intensity time-series proxies",
            "repeatable AIA WCS-aligned variability and pre-registered positive-lag diagnostics",
            "six-channel ROI-median regularized DEM with an explicit calibration uncertainty floor",
            "projected HMI LOS magnetic flux, gradient and PIL-length observables when JSOC metadata are verified",
            "HMI SHARP CEA radial flux, horizontal field, vertical-current and uncertainty-aware surface proxies",
            "automatic-ROI spatial coherence, apparent propagation and relative hot-event fluence diagnostics",
        ],
        "notSuitableFor": [
            "sub-pixel/PSF-deconvolved publication-grade co-alignment",
            "coronal free magnetic energy, NLFFF topology or reconnection-rate inference",
            "spatially resolved publication-grade DEM or spectroscopic inversion",
            "manual single-loop morphology, spectroscopic energy flux or total energy closure",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--cache-dir",
        help="Optional isolated preprocessing-cache directory for reproducibility audits",
    )
    parser.add_argument(
        "--mode", choices=["discovery", "validation", "holdout"], default="discovery"
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    root = Path(args.dataset_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    metadata_supplements, metadata_audit = load_metadata_supplements(manifest, root)
    vector_supplement, vector_supplement_audit = load_vector_supplement(manifest, root)
    cache_dir = (
        Path(args.cache_dir).resolve()
        if args.cache_dir
        else root / "derived" / PREPROCESSING_VERSION
    )
    preprocessing_stats = {
        "requestedFrameLoads": 0,
        "cacheHits": 0,
        "cacheMisses": 0,
        "cacheReadFailures": [],
        "cacheWriteFailures": [],
        "qualityRejectedFrames": 0,
        "_sourcePaths": {},
        "_cachePaths": {},
    }
    target_case = next((item for item in manifest["cases"] if item["caseId"] == args.case_id), None)
    if target_case is None:
        raise SystemExit(f"case not found: {args.case_id}")
    limit = 18 if args.mode in ("validation", "holdout") else 12
    target = process_case(
        manifest,
        root,
        target_case,
        limit,
        cache_dir,
        preprocessing_stats,
        metadata_supplements,
    )
    target["vectorMagnetic"] = process_vector_case(
        vector_supplement, root, target_case["caseId"]
    )
    background_case = next(
        (
            item
            for item in manifest["cases"]
            if item["caseId"] != target_case["caseId"]
            and item["activeRegion"] == target_case["activeRegion"]
            and "background" in item["caseId"]
        ),
        None,
    )
    baseline = (
        process_case(
            manifest,
            root,
            background_case,
            min(limit, 8),
            cache_dir,
            preprocessing_stats,
            metadata_supplements,
            target["roi"],
        )
        if background_case
        else None
    )
    if baseline is not None and background_case is not None:
        baseline["vectorMagnetic"] = process_vector_case(
            vector_supplement, root, background_case["caseId"]
        )
    diagnostics = diagnostic_summary(target, baseline)
    spectroscopy, spectroscopy_audit = load_spectroscopy_diagnostic(
        manifest, root, target_case["caseId"]
    )
    diagnostics["spectroscopy"] = spectroscopy
    scientific_result_fingerprint = hashlib.sha256(
        json.dumps(
            json_safe(
                {
                    "manifestSha256": sha256(manifest_path),
                    "caseId": target_case["caseId"],
                    "mode": args.mode,
                    "preprocessingVersion": PREPROCESSING_VERSION,
                    "target": target,
                    "baseline": baseline,
                    "diagnostics": diagnostics,
                }
            ),
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    result = {
        "schemaVersion": 2,
        "scriptVersion": SCRIPT_VERSION,
        "mode": args.mode,
        # Use the immutable dataset snapshot timestamp so the scientific
        # result remains reproducible across cache-cold and cache-warm runs.
        "generatedAt": str(manifest.get("generatedAt") or target_case["startTai"]),
        "manifestPath": str(manifest_path),
        "manifestSha256": sha256(manifest_path),
        "target": target,
        "baseline": baseline,
        "diagnostics": diagnostics,
        "preprocessing": preprocessing_summary(
            preprocessing_stats, cache_dir, manifest, metadata_audit
        ),
        "dataSupplementAudit": [*vector_supplement_audit, *spectroscopy_audit],
        "analysisDesign": {
            "split": args.mode,
            "featureExtractorVersion": PREPROCESSING_VERSION,
            "parametersFrozen": args.mode == "holdout",
            "preRegisteredCoolingPairs": [list(pair) for pair in COOLING_SEQUENCE_PAIRS],
            "preRegisteredPeakProminenceGrid": list(PEAK_PROMINENCE_GRID),
            "multipleComparisonCorrection": "Holm family-wise correction across five cooling pairs",
            "outcomeLabelsUsedForRoiSelection": False,
            "scientificResultFingerprint": scientific_result_fingerprint,
            "maximumSeriesFramesPerStream": MAX_SERIES_FRAMES,
            "usesAllRegisteredFramesBelowCap": True,
        },
        "limitations": [
            "ROI 由 AIA 193 Å 时间变异自动选择，尚未经过人工日冕环掩膜核验。",
            "AIA 已在降采样帧上使用线性 WCS 重投影到 193 Å 参考 ROI；未处理 PSF、差分旋转和亚像素残差。",
            "HMI 视向磁图使用校验过的 JSOC record 元数据旁车完成共空间投影视向磁通、梯度与 PIL 长度。",
            "HMI SHARP CEA 使用 Br/Bt/Bp、分量误差和消歧置信度计算径向磁通、电流与能量面密度代理；未进行势场/NLFFF 外推，不能称为日冕自由能或重联率。",
            "冷却时延、积分强度周期和热通道变异都不是机制唯一诊断。",
            (
                "当前包含事件匹配的 IRIS Level-2 相对 Doppler 诊断；它仍不等于真实能流闭合，EIS 密度/非热速度转换目前仅覆盖 AR11899 正控事件，"
                "NuSTAR 计数率链尚无响应矩阵物理通量。"
                if spectroscopy.get("rasterCount", 0) > 0
                else "当前包含 ROI 中位强度六通道正则化 DEM、自动空间相干/表观传播和相对事件 fluence；不包含可用光谱、真实能流闭合或 MHD 前向模型。"
            ),
            "256 像素轻量派生帧是有损时序代理；原始 FITS 必须保留以支持空间配准和更高阶物理诊断。",
            *(
                ["留出集仍使用冻结的自动 ROI 算法从输入影像定位高变异区域；它没有读取结果标签，但仍需在最终报告中披露这种数据自适应选择。"]
                if args.mode == "holdout"
                else []
            ),
        ],
    }
    result = json_safe(result)
    metrics_path = output_dir / "coronal_metrics.json"
    figure_path = output_dir / "coronal_diagnostics.png"
    metrics_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    plot_result(target, baseline, figure_path)
    # ASCII-safe JSON keeps the CLI machine-readable on Windows terminals
    # whose inherited code page cannot encode symbols such as Angstrom (Å).
    print(json.dumps({
        "metricsPath": str(metrics_path),
        "figurePath": str(figure_path),
        "metricsSha256": sha256(metrics_path),
        "figureSha256": sha256(figure_path),
        "result": result,
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
