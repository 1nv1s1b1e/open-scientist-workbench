#!/usr/bin/env python3
"""NuSTAR solar hard-X-ray chain: pointing audit, geometry, and count-rate limits.

Version 2 turns the input-quality audit (v1) into a bounded science chain that
extracts everything the registered Level-2 products support without a CALDB
response matrix:

* pointing/ghost-ray audit from the attitude-orbit file (Sun off-axis angle,
  Earth-limb elevation, SAA);
* livetime-corrected count rates in frozen PI bands (grade-0 events);
* solar-disc/off-limb geometry in the field-of-view frame, located by fitting
  the solar limb as a circle whose step radius must reproduce the frozen solar
  radius (internal validation, orientation-free, no roll convention involved);
* exact-Poisson significance of the on-disc excess over the solid-angle-scaled
  off-limb background, or a 3-sigma count-rate upper limit where no excess is
  found;
* the FPMA/FPMB cross-module consistency deep dive, including soft-band rate
  ratios for the flagged ObsID 20001005001.

Count rates are not physical fluxes: response-matrix unfolding and a
livetime-aware spectral fit remain required before any mechanism use.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits
from scipy import stats


VERSION = "nustar-hxr-solar-geometry-v2"
# NuSTAR PI channels are approximately 40 eV wide.
PI_BANDS = {
    "soft_2_6_keV": (50, 150),
    "hard_6_10_keV": (150, 250),
}
GEOMETRY_BAND = (20, 80)  # 0.8-3.2 keV: solar-dominated band for the limb map
SOLAR_RADIUS_ARCSEC = 959.63
ON_DISC_MAX_ARCSEC = 959.63
OFF_LIMB_MIN_ARCSEC = 1050.0
OFF_LIMB_MAX_ARCSEC = 1350.0
LIMB_FIT_RADIUS_TOLERANCE_ARCSEC = 60.0
GHOST_RAY_OFF_AXIS_DEG = 4.0 / 60.0
FULLY_ON_DISC_SUN_ANGLE_DEG = 4.5 / 60.0
UPPER_LIMIT_SIGMA = 3.0
UPPER_LIMIT_ONE_SIDED_PROB = 0.99865  # 3-sigma equivalent


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


def verify_asset(dataset_root: Path, asset: dict[str, Any]) -> Path:
    path = dataset_root / str(asset["relativePath"])
    if not path.is_file() or sha256(path) != asset.get("sha256"):
        raise SystemExit(f"NuSTAR asset missing or checksum mismatch: {asset.get('assetId')}")
    return path


def livetime_exposure(hk_path: Path, start: float, stop: float) -> dict[str, Any]:
    with fits.open(hk_path, memmap=True) as hdus:
        hk = hdus["HK1FPM"].data
        hk_time = np.asarray(hk["TIME"], dtype=float)
        livetime = np.asarray(hk["LIVETIME"], dtype=float)
    mask = (
        np.isfinite(hk_time)
        & np.isfinite(livetime)
        & (hk_time >= start)
        & (hk_time <= stop)
        & (livetime >= 0)
        & (livetime <= 1)
    )
    selected_time = hk_time[mask]
    selected_livetime = livetime[mask]
    if selected_time.size < 2:
        return {
            "effectiveLivetimeExposureSeconds": None,
            "housekeepingSampleCount": int(selected_livetime.size),
        }
    return {
        "effectiveLivetimeExposureSeconds": float(np.trapezoid(selected_livetime, selected_time)),
        "housekeepingSampleCount": int(selected_livetime.size),
        "medianLivetimeFraction": float(np.median(selected_livetime)),
    }


def pointing_audit(attorb_path: Path, start: float, stop: float) -> dict[str, Any]:
    with fits.open(attorb_path, memmap=True) as hdus:
        rows = hdus[1].data
        time = np.asarray(rows["TIME"], dtype=float)
        sun_angle = np.asarray(rows["SUN_ANGLE"], dtype=float)
        elv = np.asarray(rows["ELV"], dtype=float)
        saa = np.asarray(rows["SAA"], dtype=int)
    mask = (time >= start) & (time <= stop)
    if not np.any(mask):
        return {"usable": False, "reason": "no attitude-orbit rows inside the science interval"}
    selected_sun = sun_angle[mask]
    return {
        "usable": True,
        "medianSunOffAxisDeg": float(np.median(selected_sun)),
        "maxSunOffAxisDeg": float(np.max(selected_sun)),
        "medianEarthLimbElevationDeg": float(np.median(elv[mask])),
        "saaRowFraction": float(np.mean(saa[mask] != 0)),
        "unoccultedRowFraction": float(np.mean((elv[mask] > 0) & (saa[mask] == 0))),
        "ghostRayRisk": bool(np.median(selected_sun) > GHOST_RAY_OFF_AXIS_DEG),
        "fullyOnDiscPointing": bool(np.median(selected_sun) < FULLY_ON_DISC_SUN_ANGLE_DEG),
    }


def fit_limb_circle(
    x: np.ndarray, y: np.ndarray, sun_off_axis_deg: float
) -> dict[str, Any]:
    """Locate the solar limb in field-of-view coordinates.

    The search is physically constrained by the attitude audit: the Sun
    center must sit at the projected Sun off-axis distance from the field
    center, at an unknown position angle. A ring search over that angle
    finds the center whose radial density profile shows the cleanest step,
    and the empirical step radius is then validated against the frozen
    solar radius. A wrong field-center convention, a detector edge, or a
    misread SUN_ANGLE therefore fail validation instead of silently
    producing geometry. Only radial distances enter the geometry, so no
    roll-convention assumption is involved.
    """
    bin_size = 4.0
    edges = np.arange(-4.0, 724.1, bin_size)
    hist, xe, ye = np.histogram2d(x, y, bins=[edges, edges])
    hist = hist.T
    cx_grid = 0.5 * (xe[:-1] + xe[1:])
    cy_grid = 0.5 * (ye[:-1] + ye[1:])
    gx, gy = np.meshgrid(cx_grid, cy_grid)
    gx, gy, counts = gx.ravel(), gy.ravel(), hist.ravel()
    occupied = counts > 0
    gx, gy, counts = gx[occupied], gy[occupied], counts[occupied]
    if counts.size < 50:
        return {"usable": False, "reason": "insufficient geometry-band support"}
    bin_area = bin_size * bin_size
    field_center = (360.0, 360.0)
    sun_distance = sun_off_axis_deg * 3600.0
    best: tuple[float, float, float] | None = None  # (score, cx, cy)
    for phi in np.arange(0.0, 360.0, 1.0):
        direction = (float(np.cos(np.radians(phi))), float(np.sin(np.radians(phi))))
        for distance in (sun_distance - 100.0, sun_distance - 50.0, sun_distance,
                         sun_distance + 50.0, sun_distance + 100.0):
            cx = field_center[0] + distance * direction[0]
            cy = field_center[1] + distance * direction[1]
            radius = np.hypot(gx - cx, gy - cy)
            inner = radius < 900.0
            outer = (radius > 1040.0) & (radius < 1180.0)
            if np.count_nonzero(inner) < 50 or np.count_nonzero(outer) < 50:
                continue
            inner_density = float(np.median(counts[inner])) / bin_area
            outer_density = float(np.median(counts[outer])) / bin_area
            if inner_density <= 0 or outer_density <= 0:
                continue
            score = inner_density / outer_density
            if best is None or score > best[0]:
                best = (score, cx, cy)
    if best is None or best[0] < 2.0:
        return {
            "usable": False,
            "reason": (
                "no position angle around the projected Sun distance shows a "
                "disc/off-limb contrast step"
            ),
        }
    _, cx, cy = best
    # refine the position angle and distance around the coarse optimum
    step_size, angle_step = 50.0, 1.0
    for _ in range(3):
        improved = False
        for d_phi in (-angle_step, 0.0, angle_step):
            for d_distance in (-step_size, 0.0, step_size):
                phi = np.degrees(np.arctan2(cy - field_center[1], cx - field_center[0])) + d_phi
                distance = float(np.hypot(cx - field_center[0], cy - field_center[1])) + d_distance
                nx = field_center[0] + distance * float(np.cos(np.radians(phi)))
                ny = field_center[1] + distance * float(np.sin(np.radians(phi)))
                radius = np.hypot(gx - nx, gy - ny)
                inner = radius < 900.0
                outer = (radius > 1040.0) & (radius < 1180.0)
                if np.count_nonzero(inner) < 50 or np.count_nonzero(outer) < 50:
                    continue
                inner_density = float(np.median(counts[inner])) / bin_area
                outer_density = float(np.median(counts[outer])) / bin_area
                if inner_density <= 0 or outer_density <= 0:
                    continue
                score = inner_density / outer_density
                if score > best[0]:
                    best = (score, nx, ny)
                    improved = True
        if not improved:
            step_size = max(1.0, step_size / 2.0)
            angle_step = max(0.25, angle_step / 2.0)
    _, cx, cy = best
    radius = np.hypot(gx - cx, gy - cy)
    profile_edges = np.arange(200.0, 1400.1, 40.0)
    density, _ = np.histogram(radius, bins=profile_edges, weights=counts)
    area_bins, _ = np.histogram(radius, bins=profile_edges)
    density = np.divide(density, area_bins, out=np.zeros_like(density), where=area_bins > 0) / bin_area
    centers = 0.5 * (profile_edges[:-1] + profile_edges[1:])
    on_disc_level = float(np.median(density[(centers >= 880) & (centers < 960)]))
    outside = (centers >= 960.0) & (centers <= 1200.0) & (density < 0.5 * on_disc_level)
    if on_disc_level <= 0 or not np.any(outside):
        return {"usable": False, "reason": "limb step not detectable in the radial profile"}
    step_radius = float(np.min(centers[outside]))
    return {
        "usable": True,
        "centerXArcsec": round(cx, 1),
        "centerYArcsec": round(cy, 1),
        "discContrast": round(best[0], 2),
        "estimatedLimbRadiusArcsec": round(step_radius, 1),
        "radiusConsistentWithSolarRadius": bool(
            abs(step_radius - SOLAR_RADIUS_ARCSEC) <= LIMB_FIT_RADIUS_TOLERANCE_ARCSEC
        ),
    }


def region_areas(
    geometry: dict[str, Any], bin_size: float = 4.0
) -> dict[str, float] | None:
    """Solid angles (arcsec^2) of the on-disc and off-limb parts of the FoV box."""
    if not geometry.get("usable") or not geometry.get("radiusConsistentWithSolarRadius"):
        return None
    cx, cy = geometry["centerXArcsec"], geometry["centerYArcsec"]
    grid = np.arange(-4.0, 724.0, bin_size)
    gx, gy = np.meshgrid(grid, grid)
    radius = np.hypot(gx - cx, gy - cy)
    bin_area = bin_size * bin_size
    on_disc = float(np.count_nonzero(radius <= ON_DISC_MAX_ARCSEC)) * bin_area
    off_limb = (
        float(np.count_nonzero((radius >= OFF_LIMB_MIN_ARCSEC) & (radius <= OFF_LIMB_MAX_ARCSEC)))
        * bin_area
    )
    if on_disc <= 0 or off_limb <= 0:
        return None
    return {"onDiscArcsec2": on_disc, "offLimbArcsec2": off_limb}


def poisson_excess(
    source_counts: int,
    background_counts: int,
    area_ratio: float,
    exposure: float,
) -> dict[str, Any]:
    """Exact-Poisson significance of the source excess over scaled background."""
    expected_background = background_counts * area_ratio
    result: dict[str, Any] = {
        "sourceCounts": int(source_counts),
        "offLimbBackgroundCounts": int(background_counts),
        "scaledBackgroundCounts": round(float(expected_background), 2),
    }
    if source_counts > 0 and expected_background > 0:
        p_value = float(stats.poisson.sf(source_counts - 1, max(expected_background, 1e-9)))
    else:
        p_value = 1.0
    significance = float(stats.norm.isf(p_value)) if 0.0 < p_value < 1.0 else (8.0 if p_value <= 0 else 0.0)
    result["excessCounts"] = round(source_counts - expected_background, 1)
    result["significanceSigma"] = round(min(max(significance, 0.0), 8.0), 2)
    if significance >= UPPER_LIMIT_SIGMA and source_counts > expected_background:
        result["detection"] = True
        result["sourceCountRatePerSecond"] = round(source_counts / exposure, 6) if exposure > 0 else None
        result["countRateUpperLimitPerSecond"] = None
    else:
        result["detection"] = False
        if expected_background < 100.0:
            upper_counts = float(stats.poisson.isf(1.0 - UPPER_LIMIT_ONE_SIDED_PROB, max(expected_background, 1e-9)))
        else:
            upper_counts = expected_background + UPPER_LIMIT_SIGMA * np.sqrt(expected_background)
        # A zero-background Poisson quantile would allow zero counts; the
        # honest 3-sigma frequentist limit with zero background is -ln(1-p).
        upper_counts = max(upper_counts, float(-np.log(1.0 - UPPER_LIMIT_ONE_SIDED_PROB)))
        result["countRateUpperLimitPerSecond"] = (
            round(upper_counts / exposure, 6) if exposure > 0 else None
        )
    return result


def analyze_module(
    dataset_root: Path,
    assets: dict[str, dict[str, Any]],
    obsid: str,
    module: str,
) -> dict[str, Any]:
    event_asset = assets[f"nustar-{obsid}-{module.lower()}06-events"]
    hk_asset = assets[f"nustar-{obsid}-{module.lower()}-housekeeping"]
    attorb_asset = assets.get(f"nustar-{obsid}-{module.lower()}-attitude-orbit")
    event_path = verify_asset(dataset_root, event_asset)
    hk_path = verify_asset(dataset_root, hk_asset)
    attorb_path = verify_asset(dataset_root, attorb_asset) if attorb_asset else None

    result: dict[str, Any] = {
        "obsid": obsid,
        "caseId": event_asset["caseId"],
        "module": module,
        "mode": "06",
    }
    with fits.open(event_path, memmap=True) as hdus:
        events = hdus["EVENTS"]
        header = events.header
        if header.get("OBSMODE") != "SCIENCE_SC":
            raise SystemExit(f"{event_path.name} is not SCIENCE_SC")
        time = np.asarray(events.data["TIME"], dtype=float)
        pi = np.asarray(events.data["PI"], dtype=float)
        grade = np.asarray(events.data["GRADE"], dtype=int)
        x = np.asarray(events.data["X"], dtype=float)
        y = np.asarray(events.data["Y"], dtype=float)
        flagged = np.zeros(events.data["TIME"].shape, dtype=bool)
        for column in ("BADPOS", "HOTPOS"):
            if column in events.columns.names:
                flagged |= np.any(np.asarray(events.data[column], dtype=bool), axis=1)
        gti = hdus["GTI"].data
        gti_seconds = float(np.sum(np.asarray(gti["STOP"]) - np.asarray(gti["START"])))
        start, stop = float(header.get("TSTART")), float(header.get("TSTOP"))
        result["dateObs"] = str(header.get("DATE-OBS"))
        result["dateEnd"] = str(header.get("DATE-END"))
    result["gtiExposureSeconds"] = gti_seconds
    result.update(livetime_exposure(hk_path, start, stop))
    audit = (
        pointing_audit(attorb_path, start, stop)
        if attorb_path
        else {"usable": False, "reason": "attitude-orbit asset not registered"}
    )
    result["pointingAudit"] = audit
    accepted = (time >= start) & (time <= stop) & (grade == 0) & ~flagged
    result["grade0EventCount"] = int(np.count_nonzero(accepted))
    result["flaggedEventCount"] = int(np.count_nonzero((time >= start) & (time <= stop) & flagged))
    exposure = result.get("effectiveLivetimeExposureSeconds") or gti_seconds

    bands: dict[str, Any] = {}
    for band, (lo, hi) in PI_BANDS.items():
        counts = int(np.count_nonzero(accepted & (pi >= lo) & (pi < hi)))
        bands[band] = {
            "piRange": [lo, hi],
            "counts": counts,
            "countRatePerSecond": round(counts / exposure, 6) if exposure > 0 else None,
        }
    result["countBands"] = bands

    geometry: dict[str, Any] = {"usable": False}
    if audit.get("fullyOnDiscPointing"):
        geometry = {
            "usable": True,
            "mode": "fully-on-disc-pointing",
            "reason": (
                "Sun off-axis below 4.5 arcmin, so the entire field of view lies inside the "
                "solar disc; no off-limb background region exists and rates are not "
                "background-subtracted"
            ),
            "onDiscRegion": "entire field of view",
        }
    elif audit.get("usable") and int(np.count_nonzero(accepted & (pi >= GEOMETRY_BAND[0]) & (pi < GEOMETRY_BAND[1]))) >= 500:
        geometry_mask = accepted & (pi >= GEOMETRY_BAND[0]) & (pi < GEOMETRY_BAND[1])
        fit = fit_limb_circle(
            x[geometry_mask], y[geometry_mask], audit["medianSunOffAxisDeg"]
        )
        geometry = fit
        if fit.get("usable") and fit.get("radiusConsistentWithSolarRadius"):
            radius = np.hypot(x - fit["centerXArcsec"], y - fit["centerYArcsec"])
            on_disc = accepted & (radius <= ON_DISC_MAX_ARCSEC)
            off_limb = accepted & (radius >= OFF_LIMB_MIN_ARCSEC) & (radius <= OFF_LIMB_MAX_ARCSEC)
            areas = region_areas(fit)
            if areas:
                area_ratio = areas["onDiscArcsec2"] / areas["offLimbArcsec2"]
                band_results: dict[str, Any] = {}
                for band, (lo, hi) in PI_BANDS.items():
                    src = int(np.count_nonzero(on_disc & (pi >= lo) & (pi < hi)))
                    bkg = int(np.count_nonzero(off_limb & (pi >= lo) & (pi < hi)))
                    band_results[band] = poisson_excess(src, bkg, area_ratio, exposure)
                geometry["bands"] = band_results
                geometry["regionAreas"] = {key: round(value, 1) for key, value in areas.items()}
            geometry["onDiscEventCount"] = int(np.count_nonzero(on_disc))
            geometry["offLimbEventCount"] = int(np.count_nonzero(off_limb))
        elif fit.get("usable"):
            geometry["reason"] = (
                "limb-fit radius is inconsistent with the frozen solar radius; spatial "
                "products are disabled and only time-domain products are reported"
            )
    else:
        geometry = {
            "usable": False,
            "reason": (
                "insufficient geometry-band events or no attitude-orbit audit; "
                "time-domain products only"
            ),
        }
    result["geometry"] = geometry
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--root-manifest", type=Path, required=True)
    args = parser.parse_args()
    dataset_root = args.dataset_root.resolve()
    supplement_path = dataset_root / "supplements/targeted-discriminants-v1/manifest.json"
    supplement = json.loads(supplement_path.read_text(encoding="utf-8"))
    assets = {
        row["assetId"]: row
        for row in supplement.get("assets", [])
        if row.get("instrument") == "NuSTAR"
    }
    obsids = sorted({str(asset["obsid"]) for asset in assets.values()})
    observations: list[dict[str, Any]] = []
    for obsid in obsids:
        for module in ("A", "B"):
            observations.append(analyze_module(dataset_root, assets, obsid, module))
            print(f"analyzed {obsid} module {module}", flush=True)
    cross_module: list[dict[str, Any]] = []
    for obsid in obsids:
        pair = {row["module"]: row for row in observations if row["obsid"] == obsid}
        count_ratio = pair["A"]["grade0EventCount"] / max(1, pair["B"]["grade0EventCount"])
        exposure_a = pair["A"].get("effectiveLivetimeExposureSeconds") or 0
        exposure_b = pair["B"].get("effectiveLivetimeExposureSeconds") or 0
        exposure_ratio = exposure_a / max(1e-12, exposure_b)
        soft_a = pair["A"]["countBands"]["soft_2_6_keV"]["counts"]
        soft_b = pair["B"]["countBands"]["soft_2_6_keV"]["counts"]
        cross_module.append(
            {
                "obsid": obsid,
                "grade0EventCountRatioAtoB": round(count_ratio, 3),
                "effectiveExposureRatioAtoB": round(exposure_ratio, 3),
                "softBandCountRatioAtoB": round(soft_a / max(1, soft_b), 3),
                "consistencyPass": 0.1 <= count_ratio <= 10 and 0.5 <= exposure_ratio <= 2,
            }
        )
    output = {
        "schemaVersion": 2,
        "analysisVersion": VERSION,
        "generatedAt": now(),
        "instrument": "NuSTAR",
        "moduleObservationCount": len(observations),
        "analyzedMode": "06",
        "registeredModesNotAnalyzed": ["02", "03"],
        "piBands": PI_BANDS,
        "frozenGeometry": {
            "solarRadiusArcsec": SOLAR_RADIUS_ARCSEC,
            "onDiscMaxArcsec": ON_DISC_MAX_ARCSEC,
            "offLimbAnnulusArcsec": [OFF_LIMB_MIN_ARCSEC, OFF_LIMB_MAX_ARCSEC],
            "limbFitRadiusToleranceArcsec": LIMB_FIT_RADIUS_TOLERANCE_ARCSEC,
            "ghostRayOffAxisLimitDeg": GHOST_RAY_OFF_AXIS_DEG,
        },
        "observations": observations,
        "crossModuleConsistency": cross_module,
        "inputAssetIds": sorted(assets.keys()),
        "mechanismEvidencePermitted": False,
        "evidenceRole": "hxr_count_rate_chain",
        "physicalFluxAvailable": False,
        "countRateProductsAvailable": True,
        "boundaries": [
            "PI channels are converted to approximate energies with the frozen 40 eV per "
            "channel scale; livetime-corrected count rates are not physical fluxes and a "
            "response-matrix spectral fit (CALDB) is still required before mechanism use.",
            "Solar-disc geometry is located in the field-of-view frame by a limb-circle fit "
            "validated against the frozen solar radius; the roll-convention-dependent solar "
            "coordinate mapping is deliberately not attempted on these 2014-era files whose "
            "headers lack the binary-table WCS keywords nustar_pysolar requires.",
            "A Sun off-axis angle above 4 arcmin flags possible ghost-ray contamination; the "
            "off-limb background subtraction does not remove ghost-ray structure.",
            "A failed FPMA/FPMB count-consistency audit is a quality warning, not a physical "
            "contradiction.",
        ],
    }
    output_path_v2 = dataset_root / "derived/nustar-hxr-solar-geometry-v2/nustar_geometry.json"
    write_json(output_path_v2, output)
    product = {
        "kind": VERSION,
        "relativePath": output_path_v2.relative_to(dataset_root).as_posix(),
        "sha256": sha256(output_path_v2),
        "analysisVersion": VERSION,
        "inputAssetIds": output["inputAssetIds"],
        "supersedes": "nustar-hxr-quality-v1",
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
