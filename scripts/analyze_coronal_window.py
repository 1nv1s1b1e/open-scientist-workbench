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
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.io import fits
from scipy.ndimage import uniform_filter
from scipy.signal import find_peaks, periodogram


SCRIPT_VERSION = "1.0.0"


def evenly_spaced(items: list[dict], limit: int) -> list[dict]:
    if len(items) <= limit:
        return items
    indices = np.linspace(0, len(items) - 1, limit).round().astype(int)
    return [items[int(index)] for index in sorted(set(indices.tolist()))]


def first_image_hdu(path: Path):
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

                return np.asarray(data, dtype=np.float32), {
                    "exposure": float(value("EXPTIME", 1.0) or 1.0),
                    "quality": str(value("QUALITY", "unknown")),
                    "dateObs": str(value("DATE-OBS", value("T_OBS", ""))),
                }
    raise ValueError(f"no image HDU in {path}")


def reduced_frame(path: Path, target: int = 256) -> tuple[np.ndarray, dict]:
    data, header = first_image_hdu(path)
    while data.ndim > 2:
        data = data[0]
    step = max(1, int(math.ceil(max(data.shape) / target)))
    reduced = data[::step, ::step].astype(np.float32, copy=False)
    exposure = float(header["exposure"])
    if exposure > 0:
        reduced = reduced / exposure
    reduced[~np.isfinite(reduced)] = np.nan
    return reduced, {
        "shape": [int(data.shape[0]), int(data.shape[1])],
        "reducedShape": [int(reduced.shape[0]), int(reduced.shape[1])],
        "exposure": exposure,
        "quality": header["quality"],
        "dateObs": header["dateObs"],
    }


def normalized_crop(frame: np.ndarray, roi: dict) -> np.ndarray:
    height, width = frame.shape
    y0 = max(0, min(height - 1, int(round(roi["y0"] * height))))
    y1 = max(y0 + 1, min(height, int(round(roi["y1"] * height))))
    x0 = max(0, min(width - 1, int(round(roi["x0"] * width))))
    x1 = max(x0 + 1, min(width, int(round(roi["x1"] * width))))
    return frame[y0:y1, x0:x1]


def select_roi(frames: list[np.ndarray]) -> dict:
    common_y = min(frame.shape[0] for frame in frames)
    common_x = min(frame.shape[1] for frame in frames)
    stack = np.stack([frame[:common_y, :common_x] for frame in frames])
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
    x = x - x[0]
    slope, intercept = np.polyfit(x, y, 1)
    detrended = y - (slope * x + intercept)
    z = robust_z(detrended)
    peaks, properties = find_peaks(z, prominence=1.5)
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
        "startEpoch": float(x[0]),
        "durationSeconds": float(x[-1] - x[0]),
        "cadenceSeconds": effective_cadence,
        "mean": float(np.nanmean(y)),
        "std": float(np.nanstd(y)),
        "relativeVariability": float(np.nanstd(y) / (abs(np.nanmean(y)) + 1e-8)),
        "linearSlopePerHour": float(slope * 3600.0),
        "peakCount": int(len(peaks)),
        "peakProminenceMedian": float(np.nanmedian(properties["prominences"])) if len(peaks) else 0.0,
        "dominantPeriodSeconds": dominant_period,
        "spectralSnr": spectral_snr,
        "values": [float(value) for value in y],
        "timesSeconds": [float(value) for value in x],
    }


def correlation_metrics(left: dict | None, right: dict | None) -> dict:
    if not left or not right or not left.get("usable") or not right.get("usable"):
        return {"usable": False}
    left_t = np.asarray(left["timesSeconds"], dtype=float)
    right_t = np.asarray(right["timesSeconds"], dtype=float)
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
    return {
        "usable": True,
        "correlation": float(corr[index]),
        "lagSeconds": float(lags[index]),
        "sampleCount": int(len(grid)),
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


def process_case(manifest: dict, root: Path, case: dict, limit: int, roi: dict | None = None) -> dict:
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
    file_metadata: dict[str, dict] = {}
    used: list[dict] = []
    failures: list[str] = []
    for observation in reference_observations:
        asset = assets[observation["assetId"]]
        path = root / asset["relativePath"]
        try:
            frame, metadata = reduced_frame(path)
            reference_frames.append(frame)
            file_metadata[observation["assetId"]] = metadata
        except Exception as error:
            failures.append(f"{observation['assetId']}: {error}")
    if len(reference_frames) < 3:
        raise ValueError(f"case {case['caseId']} has fewer than three readable 193A frames")
    selected_roi = roi or select_roi(reference_frames)

    channels: dict[str, dict] = {}
    sampled_assets: dict[str, str] = {}
    for (stream, band), observations in sorted(grouped.items()):
        selected = (
            observations[: max(36, limit * 2)] if "burst" in stream else evenly_spaced(observations, limit)
        )
        times: list[float] = []
        values: list[float] = []
        absolute_values: list[float] = []
        for observation in selected:
            asset = assets[observation["assetId"]]
            path = root / asset["relativePath"]
            try:
                frame, metadata = reduced_frame(path)
                crop = normalized_crop(frame, selected_roi)
                finite = crop[np.isfinite(crop)]
                if finite.size == 0:
                    raise ValueError("ROI has no finite pixels")
                if observation["instrument"] == "SDO/HMI":
                    value = float(np.nanmean(np.abs(finite)))
                    absolute_values.append(float(np.nanpercentile(np.abs(finite), 95)))
                else:
                    value = float(np.nanmedian(finite))
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
            "p95AbsMedian": float(np.nanmedian(absolute_values)) if absolute_values else None,
        })
        channels[f"{stream}:{band}"] = metrics

    def channel(band: str, contains: str | None = None) -> dict | None:
        candidates = [value for key, value in channels.items() if key.endswith(f":{band}")]
        if contains:
            candidates = [value for value in candidates if contains in value["streamId"]]
        return max(candidates, key=lambda item: item.get("count", 0), default=None)

    comparisons = {
        "burst171_193": correlation_metrics(channel("171 Å", "burst"), channel("193 Å", "burst")),
        "core94_131": correlation_metrics(channel("94 Å"), channel("131 Å")),
    }
    return {
        "caseId": case["caseId"],
        "label": case["label"],
        "activeRegion": case["activeRegion"],
        "roi": selected_roi,
        "channels": channels,
        "comparisons": comparisons,
        "usedObservationCount": len(used),
        "sampleIds": [item["logicalId"] for item in used[:48]],
        "sampledChecksums": sampled_assets,
        "readFailures": failures[:30],
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
    hot_variability = float(np.nanmean([
        (hot94 or {}).get("relativeVariability", np.nan),
        (hot131 or {}).get("relativeVariability", np.nan),
    ]))
    magnetic_change = abs(float((hmi or {}).get("linearSlopePerHour", 0)))
    reconnection_support = bool(hot_peaks >= 2 and np.isfinite(hot_variability) and hot_variability >= 0.02 and magnetic_change > 0)

    baseline_ratio = None
    if baseline:
        baseline_hot = [
            value.get("relativeVariability", np.nan)
            for key, value in baseline["channels"].items()
            if key.endswith(":94 Å") or key.endswith(":131 Å")
        ]
        base_value = float(np.nanmean(baseline_hot)) if baseline_hot else float("nan")
        if np.isfinite(base_value) and base_value > 0 and np.isfinite(hot_variability):
            baseline_ratio = float(hot_variability / base_value)

    return {
        "wave": {
            "observableStatus": "support" if wave_support else "unknown",
            "periodAgreement": period_agreement,
            "periodResolved": period_resolved,
            "cyclesCovered": cycles_covered,
            "periodsSeconds": periods,
            "crossChannelCorrelation": wave_corr.get("correlation"),
            "crossChannelLagSeconds": wave_corr.get("lagSeconds"),
            "boundary": "积分强度周期不是传播速度或能流测量，不能单独证明波动加热。",
        },
        "reconnection": {
            "observableStatus": "support" if reconnection_support else "unknown",
            "hotChannelPeakCount": hot_peaks,
            "hotChannelRelativeVariability": hot_variability if np.isfinite(hot_variability) else None,
            "magneticProxySlopePerHour": float((hmi or {}).get("linearSlopePerHour", 0)),
            "targetToBackgroundVariabilityRatio": baseline_ratio,
            "boundary": "热通道间歇性和 HMI 代理量不是重联或纳耀斑的唯一指纹。",
        },
        "coupled": {
            "observableStatus": "support" if wave_support and reconnection_support else "unknown",
            "jointIndicatorsPresent": bool(wave_support and reconnection_support),
            "boundary": "联合时序特征不能建立能量分配比例或因果耦合。",
        },
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mode", choices=["discovery", "validation"], default="discovery")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    root = Path(args.dataset_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    target_case = next((item for item in manifest["cases"] if item["caseId"] == args.case_id), None)
    if target_case is None:
        raise SystemExit(f"case not found: {args.case_id}")
    limit = 18 if args.mode == "validation" else 12
    target = process_case(manifest, root, target_case, limit)
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
    baseline = process_case(manifest, root, background_case, min(limit, 8), target["roi"]) if background_case else None
    diagnostics = diagnostic_summary(target, baseline)
    result = {
        "schemaVersion": 1,
        "scriptVersion": SCRIPT_VERSION,
        "mode": args.mode,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "manifestPath": str(manifest_path),
        "manifestSha256": sha256(manifest_path),
        "target": target,
        "baseline": baseline,
        "diagnostics": diagnostics,
        "limitations": [
            "ROI 由 AIA 193 Å 时间变异自动选择，尚未经过人工日冕环掩膜核验。",
            "各波段在归一化像素坐标中比较，尚未执行完整 WCS 重投影。",
            "积分强度、热通道变异和视向磁场代理量都不是机制唯一诊断。",
            "当前不包含光谱、DEM 反演、传播速度、能量闭合或 MHD 前向模型。",
        ],
    }
    result = json_safe(result)
    metrics_path = output_dir / "coronal_metrics.json"
    figure_path = output_dir / "coronal_diagnostics.png"
    metrics_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    plot_result(target, baseline, figure_path)
    print(json.dumps({
        "metricsPath": str(metrics_path),
        "figurePath": str(figure_path),
        "metricsSha256": sha256(metrics_path),
        "figureSha256": sha256(figure_path),
        "result": result,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
