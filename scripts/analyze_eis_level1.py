#!/usr/bin/env python3
"""Fit the registered AR11899 Hinode/EIS Level-1 ROI without mechanism promotion.

Version 2 adds two quantitative conversions on top of the versioned line
fitting, both consuming frozen calibration inputs that are checksum-verified
against the targeted-discriminants supplement registry:

* electron density from the Si X 258.375/261.058 intensity ratio, inverted
  through the registered CHIANTI curve (`build_eis_density_calibration.py`);
* non-thermal velocities from the fitted Gaussian widths after subtracting
  the frozen EIS instrumental width (EIS Software Note 7) and the thermal
  width at each ion's formation temperature.

The product remains a descriptive positive control for a single event and
never promotes a heating mechanism by itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import eispac
import numpy as np


ROI = {"hplnMin": 178.0, "hplnMax": 183.6, "hpltMin": 53.1, "hpltMax": 70.9}
SOFTWARE_VERSION = "eis-spectroscopy-v2:eispac-0.99.4"
DENSITY_CURVE_KIND = "eis-si10-density-curve-v1"
LINES = (
    # key, wavelength, template, component, log formation T, ion mass (u)
    ("fe_xii_195", 195.119, "fe_12_195_119.2c.template.h5", 0, 6.20, 55.845),
    ("fe_xiii_202", 202.044, "fe_13_202_044.1c.template.h5", 0, 6.25, 55.845),
    ("fe_xiv_264", 264.787, "fe_14_264_787.1c.template.h5", 0, 6.30, 55.845),
    ("fe_xiv_274", 274.203, "fe_14_274_203.1c.template.h5", 0, 6.30, 55.845),
    ("si_x_258", 258.375, "si_10_258_375.1c.template.h5", 0, 6.13, 28.085),
    ("si_x_261", 261.058, "si_10_261_058.1c.template.h5", 0, 6.13, 28.085),
)
# EIS instrumental FWHM (Young 2011, EIS Software Note 7, quoting Brown et al.
# 2008): 54 mAngstrom for the SW band, 55 mAngstrom for the LW band, with a
# stated accuracy of about 3 mAngstrom. The short-wavelength CCD covers
# 170-211 Angstrom and the long-wavelength CCD covers 245-291 Angstrom.
INSTRUMENTAL_FWHM_ANGSTROM = {"sw": 0.054, "lw": 0.055}
SW_WAVELENGTH_MAX_ANGSTROM = 211.0
SPEED_OF_LIGHT_KM_S = 299792.458
FWHM_PER_SIGMA = 2.0 * float(np.sqrt(2.0 * np.log(2.0)))
ATOMIC_MASS_UNIT_KG = 1.66053906892e-27
BOLTZMANN_SI = 1.380649e-23
DENSITY_CURVE_MAX_DEX_ERROR = 0.5


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def interval(values: np.ndarray, seed: int) -> dict[str, float | int | None]:
    clean = np.asarray(values, dtype=float)
    clean = clean[np.isfinite(clean)]
    if clean.size == 0:
        return {"estimate": None, "lowerBound": None, "upperBound": None, "sampleCount": 0}
    rng = np.random.default_rng(seed)
    medians = np.median(rng.choice(clean, size=(4000, clean.size), replace=True), axis=1)
    return {
        "estimate": float(np.median(clean)),
        "lowerBound": float(np.quantile(medians, 0.025)),
        "upperBound": float(np.quantile(medians, 0.975)),
        "sampleCount": int(clean.size),
    }


def load_density_curve(
    supplement: dict[str, Any], repo_root: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    calibration = next(
        (
            row
            for row in supplement.get("calibrations", [])
            if row.get("productId") == DENSITY_CURVE_KIND
        ),
        None,
    )
    if not calibration:
        raise SystemExit(
            f"registered calibration {DENSITY_CURVE_KIND} is missing; run "
            "scripts/build_eis_density_calibration.py first"
        )
    curve_path = repo_root / "sources" / str(calibration.get("curveSource", ""))
    if not curve_path.is_file():
        raise SystemExit(f"registered density curve file is missing: {curve_path}")
    if sha256(curve_path) != calibration.get("checksum"):
        raise SystemExit("density curve checksum does not match the registered calibration")
    curve = json.loads(curve_path.read_text(encoding="utf-8"))
    primary = curve["curve"][curve["primaryTemperature"]]
    ratios = np.asarray([row["intensityRatioEnergyUnits"] for row in primary], dtype=float)
    log_density = np.asarray([row["logElectronDensityCm3"] for row in primary], dtype=float)
    if not np.all(np.diff(log_density) > 0) or not np.all(np.diff(ratios) > 0):
        raise SystemExit("registered density curve is not monotone")
    anchor = curve.get("validation", {}).get("anchor", {})
    if float(anchor.get("deviationDex", 0.0)) > DENSITY_CURVE_MAX_DEX_ERROR:
        raise SystemExit("registered density curve failed its published-anchor validation")
    return curve, {
        "ratios": ratios,
        "logDensity": log_density,
        "temperature": curve["primaryTemperature"],
        "chiantiVersion": curve["chiantiVersion"],
        "calibrationVersion": calibration.get("calibrationVersion"),
        "checksum": calibration.get("checksum"),
        "anchorDeviationDex": anchor.get("deviationDex"),
    }


def invert_density(ratio: np.ndarray, registered: dict[str, Any]) -> dict[str, Any]:
    """Invert the monotone ratio curve; ratios outside the range stay unconstrained."""
    ratios = registered["ratios"]
    log_density = registered["logDensity"]
    clean = np.asarray(ratio, dtype=float)
    clean = clean[np.isfinite(clean) & (clean > 0)]
    if clean.size == 0:
        return {
            "estimate": None,
            "lowerBound": None,
            "upperBound": None,
            "sampleCount": 0,
            "unconstrainedCount": 0,
        }
    inside = (clean >= ratios[0]) & (clean <= ratios[-1])
    inverted = np.interp(clean[inside], ratios, log_density)
    if inverted.size == 0:
        return {
            "estimate": None,
            "lowerBound": None,
            "upperBound": None,
            "sampleCount": int(clean.size),
            "unconstrainedCount": int(clean.size),
        }
    rng = np.random.default_rng(
        int.from_bytes(hashlib.sha256(inverted.astype("<f8").tobytes()).digest()[:8], "big")
    )
    medians = np.median(
        rng.choice(inverted, size=(4000, inverted.size), replace=True), axis=1
    )
    return {
        "estimate": float(np.median(inverted)),
        "lowerBound": float(np.quantile(medians, 0.025)),
        "upperBound": float(np.quantile(medians, 0.975)),
        "sampleCount": int(clean.size),
        "unconstrainedCount": int(np.count_nonzero(~inside)),
    }


def nonthermal_velocity(
    sigma_angstrom: np.ndarray,
    wavelength: float,
    log_formation_temperature: float,
    ion_mass_u: float,
    instrumental_fwhm: float,
) -> tuple[np.ndarray, float]:
    """Convert fitted Gaussian sigma to non-thermal velocity in km/s.

    Variances add: FWHM_obs^2 = FWHM_inst^2 + (lambda/c)^2 * 8 ln 2 * (kT/M + xi^2).
    The same relation reproduces the 0.0232 Å Fe XII thermal width quoted in
    EIS Software Note 7 at log T = 6.2.
    """
    fwhm_obs = FWHM_PER_SIGMA * np.asarray(sigma_angstrom, dtype=float)
    thermal_variance = (
        (wavelength / SPEED_OF_LIGHT_KM_S) ** 2
        * 8.0
        * float(np.log(2.0))
        * BOLTZMANN_SI
        * 10.0**log_formation_temperature
        / (ion_mass_u * ATOMIC_MASS_UNIT_KG)
        * 1.0e-6
    )
    excess = fwhm_obs**2 - instrumental_fwhm**2 - thermal_variance
    valid = np.isfinite(excess) & (excess > 0)
    velocity = np.full(np.shape(excess), np.nan, dtype=float)
    velocity[valid] = (
        SPEED_OF_LIGHT_KM_S
        / wavelength
        * np.sqrt(excess[valid] / (8.0 * float(np.log(2.0))))
    )
    return velocity, float(np.count_nonzero(valid)) / max(1, int(np.size(excess)))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--root-manifest", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()
    dataset_root = args.dataset_root.resolve()
    repo_root = Path(__file__).resolve().parent.parent
    supplement_path = dataset_root / "supplements/targeted-discriminants-v1/manifest.json"
    supplement = json.loads(supplement_path.read_text(encoding="utf-8"))
    calibrations = {
        row["productId"]: row for row in supplement.get("calibrations", [])
    }
    required = ("eis-ar11899-level1-data", "eis-ar11899-level1-header")
    assets = {row["assetId"]: row for row in supplement.get("assets", [])}
    for asset_id in required:
        asset = assets.get(asset_id)
        calibration = calibrations.get(asset_id)
        if not asset or not calibration:
            raise SystemExit(f"missing registered EIS input/calibration: {asset_id}")
        path = dataset_root / asset["relativePath"]
        digest = sha256(path)
        if digest != asset["sha256"] or digest != calibration["checksum"]:
            raise SystemExit(f"EIS checksum mismatch: {asset_id}")
    density_curve, registered_curve = load_density_curve(supplement, repo_root)
    data_path = dataset_root / assets[required[0]]["relativePath"]
    template_root = Path(eispac.__file__).parent / "data/templates"
    line_results: dict[str, Any] = {}
    fitted_arrays: dict[str, dict[str, np.ndarray]] = {}
    selected_x: np.ndarray | None = None
    selected_y: np.ndarray | None = None
    scan_times: list[str] = []
    for line_index, (key, wavelength, template_name, component, log_t, mass_u) in enumerate(LINES):
        cube = eispac.read_cube(str(data_path), wavelength)
        solar_x = np.asarray(cube.meta["pointing"]["solar_x"], dtype=float)
        solar_y = np.asarray(cube.meta["pointing"]["solar_y"], dtype=float)
        x_indices = np.flatnonzero((solar_x >= ROI["hplnMin"]) & (solar_x <= ROI["hplnMax"]))
        y_indices = np.flatnonzero((solar_y >= ROI["hpltMin"]) & (solar_y <= ROI["hpltMax"]))
        if x_indices.size == 0 or y_indices.size == 0:
            raise SystemExit("registered ROI does not intersect the EIS raster")
        selected_x, selected_y = solar_x[x_indices], solar_y[y_indices]
        dates = np.asarray(cube.meta["date_obs"])[x_indices]
        durations = np.asarray(cube.meta["duration"], dtype=float)[x_indices]
        valid_steps = durations > 0
        x_indices = x_indices[valid_steps]
        dates = dates[valid_steps]
        if x_indices.size == 0:
            raise SystemExit("registered ROI contains no positive-exposure EIS steps")
        scan_times = [str(value) for value in dates]
        cropped = cube[
            int(y_indices.min()) : int(y_indices.max()) + 1,
            int(x_indices.min()) : int(x_indices.max()) + 1,
            :,
        ]
        template = eispac.read_template(str(template_root / template_name))
        fit = eispac.fit_spectra(cropped, template, ncpu=max(1, args.workers))
        status = np.asarray(fit.fit["status"], dtype=float)
        valid = status > 0
        intensity = np.asarray(fit.fit["int"], dtype=float)[..., component]
        velocity = np.asarray(fit.fit["vel"], dtype=float)[..., component]
        width = np.asarray(fit.fit["width"], dtype=float)[..., component]
        intensity = np.where(valid & (intensity > 0), intensity, np.nan)
        velocity = np.where(valid, velocity, np.nan)
        width = np.where(valid & (width > 0), width, np.nan)
        fitted_arrays[key] = {"intensity": intensity, "velocity": velocity, "width": width}
        band = "sw" if wavelength <= SW_WAVELENGTH_MAX_ANGSTROM else "lw"
        instrumental_fwhm = INSTRUMENTAL_FWHM_ANGSTROM[band]
        nonthermal, valid_fraction = nonthermal_velocity(
            width, wavelength, log_t, mass_u, instrumental_fwhm
        )
        line_results[key] = {
            "wavelengthAngstrom": wavelength,
            "template": template_name,
            "ccdBand": band,
            "fitSuccessCount": int(np.count_nonzero(valid)),
            "fitPixelCount": int(valid.size),
            "intensityErgPerSecondSteradianCm2": interval(intensity, 100 + line_index),
            "relativeDopplerVelocityKmPerSecond": interval(velocity, 200 + line_index),
            "observedGaussianWidthAngstrom": interval(width, 300 + line_index),
            "instrumentalFwhmAngstrom": instrumental_fwhm,
            "logFormationTemperatureK": log_t,
            "nonthermalVelocityKmPerSecond": interval(nonthermal, 400 + line_index),
            "nonthermalValidPixelFraction": round(valid_fraction, 4),
            "nonthermalDefinition": (
                "fitted Gaussian FWHM minus instrumental and thermal widths, expressed as the "
                "most-probable non-thermal velocity; pixels below the instrumental+thermal "
                "floor are excluded from the interval and counted in the valid fraction"
            ),
        }
    ratio = fitted_arrays["si_x_258"]["intensity"] / fitted_arrays["si_x_261"]["intensity"]
    ratio_interval = interval(ratio, 401)
    electron_density = invert_density(
        np.asarray(
            [
                ratio_interval["estimate"],
                ratio_interval["lowerBound"],
                ratio_interval["upperBound"],
            ],
            dtype=float,
        ),
        registered_curve,
    )
    unconstrained = electron_density["unconstrainedCount"] or 0
    output = {
        "schemaVersion": 2,
        "analysisVersion": SOFTWARE_VERSION,
        "generatedAt": now(),
        "caseId": "ar11899-joint-spectroscopy-20131119",
        "instrument": "Hinode/EIS",
        "productLevel": "level1-hdf5",
        "inputAssets": [
            {"assetId": asset_id, "sha256": assets[asset_id]["sha256"]}
            for asset_id in required
        ],
        "densityCalibration": {
            "productId": DENSITY_CURVE_KIND,
            "chiantiVersion": registered_curve["chiantiVersion"],
            "calibrationVersion": registered_curve["calibrationVersion"],
            "checksum": registered_curve["checksum"],
            "primaryLogTemperature": registered_curve["temperature"],
            "publishedAnchorDeviationDex": registered_curve["anchorDeviationDex"],
        },
        "roiRegistration": {
            "kind": "literature-defined positive-control ROI",
            "boundsArcsec": ROI,
            "source": "https://doi.org/10.3847/1538-4357/835/2/244",
            "outcomeSelected": False,
            "xCoordinatesArcsec": selected_x.tolist() if selected_x is not None else [],
            "yCoordinateRangeArcsec": (
                [float(selected_y.min()), float(selected_y.max())]
                if selected_y is not None
                else []
            ),
            "scanStepTimes": scan_times,
        },
        "lines": line_results,
        "siX258To261IntensityRatio": ratio_interval,
        "electronDensityCm3": {
            "log10Estimate": electron_density["estimate"],
            "log10LowerBound": electron_density["lowerBound"],
            "log10UpperBound": electron_density["upperBound"],
            "estimate": (
                float(10.0 ** electron_density["estimate"])
                if electron_density["estimate"] is not None
                else None
            ),
            "lowerBound": (
                float(10.0 ** electron_density["lowerBound"])
                if electron_density["lowerBound"] is not None
                else None
            ),
            "upperBound": (
                float(10.0 ** electron_density["upperBound"])
                if electron_density["upperBound"] is not None
                else None
            ),
            "sampleCount": electron_density["sampleCount"],
            "unconstrainedCount": unconstrained,
            "method": (
                "monotone inversion of the registered CHIANTI Si X 258.375/261.058 "
                "emissivity-ratio curve at the primary temperature; the bootstrap "
                "interval of the inverted density propagates the pixel-level ratio "
                "uncertainty without assuming a density error model"
            ),
        },
        "mechanismEvidencePermitted": False,
        "evidenceRole": "positive_control_descriptive_spectroscopy",
        "boundaries": [
            "EIS has no absolute wavelength reference here; reported Doppler values are relative calibration products.",
            "Non-thermal velocities subtract the frozen 54/55 mAngstrom instrumental widths "
            "(about 3 mAngstrom accurate, EIS Software Note 7) and thermal widths at fixed "
            "formation temperatures; pixels below that floor are reported as unresolved, not zero.",
            "The electron density uses the frozen CHIANTI curve whose quiet-Sun anchor "
            "reproduces Warren (2009) to about 0.11 dex; a few-percent blend in the observed "
            "258.375 feature propagates into the density.",
            "One positive-control event cannot establish replication or identify a unique heating mechanism.",
        ],
    }
    output_path = (
        dataset_root
        / "derived/eis-spectroscopy-v2/ar11899-joint-spectroscopy-20131119/eis_metrics.json"
    )
    write_json(output_path, output)
    product = {
        "kind": "eis-versioned-line-fitting-v2",
        "caseId": output["caseId"],
        "relativePath": output_path.relative_to(dataset_root).as_posix(),
        "sha256": sha256(output_path),
        "analysisVersion": SOFTWARE_VERSION,
        "inputAssetIds": list(required),
        "calibrationProductIds": [DENSITY_CURVE_KIND],
        "mechanismEvidencePermitted": False,
        "generatedAt": output["generatedAt"],
    }
    products = [
        row
        for row in supplement.get("analysisProducts", [])
        if row.get("kind") != product["kind"]
    ]
    supplement["analysisProducts"] = [*products, product]
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
