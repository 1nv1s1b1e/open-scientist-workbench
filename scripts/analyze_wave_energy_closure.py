#!/usr/bin/env python3
"""Wave-energy-flux closure check (v1) from frozen spatial-wave/DEM products.

For every case whose frozen `aia-spatial-wave-v1` diagnostic produced an
apparent propagation speed with a confidence interval, this script:

1. computes the sound speed c_s from the frozen DEM temperature interval
   (gamma=5/3, mu=0.6) and classifies the wave type by v_prop / c_s;
2. assumes a literature active-region coronal density interval
   (n_e = 1e8 - 3e9 cm^-3, explicit assumption, NOT measured);
3. reports the wave energy flux UPPER LIMIT for an IRIS-detectable velocity
   amplitude (delta_v = 10 km/s) and the minimum velocity amplitude required
   to close the radiative loss demand of the same plasma column.

Boundaries: automated ROI path (expert human-review task pending), density is
a literature assumption, delta_v is a detection-threshold argument, not a
measured wave amplitude. mechanismEvidencePermitted=false.
Product: `wave-energy-closure-v1`, evidenceRole=diagnostic_boundary.
"""

from __future__ import annotations

import argparse
import glob
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

ANALYSIS_VERSION = "wave-energy-closure-v1"
GAMMA = 5.0 / 3.0
MU = 0.6
MP = 1.67262192369e-24  # g
K_B = 1.380649e-16  # erg/K
NE_ASSUMED_CM3 = (1.0e8, 3.0e9)
LAMBDA_ERG_CM3 = (3.0e-23, 3.0e-22)  # radiative loss function, 1-10 MK
DELTA_V_DETECT_KM_S = 10.0
L_ASSUMED_CM = (2.5e9, 1.0e10)  # loop half-length / column depth assumption


def interval_product(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    products = [x * y for x in a for y in b]
    return (min(products), max(products))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis-v4-glob", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    cases = []
    for path in sorted(glob.glob(args.analysis_v4_glob)):
        metrics = json.loads(Path(path).read_text(encoding="utf-8"))
        case_id = metrics.get("target", {}).get("caseId", Path(path).parent.name)
        spatial = metrics.get("diagnostics", {}).get("spatial_wave", {})
        dem = metrics.get("diagnostics", {}).get("dem_temperature", {})
        v_prop = next(
            (
                q
                for q in spatial.get("quantitativeResults", [])
                if q.get("metric") == "aia_spatial_apparent_propagation_speed"
            ),
            None,
        )
        t_dem = next(
            (
                q
                for q in dem.get("quantitativeResults", [])
                if q.get("metric") == "aia_dem_em_weighted_log10_temperature"
            ),
            None,
        )
        if v_prop is None or t_dem is None or t_dem.get("lowerBound") is None:
            continue
        log_t = (float(t_dem["lowerBound"]), float(t_dem["upperBound"]))
        t_k = (10.0**log_t[0], 10.0**log_t[1])
        c_s = tuple(
            152.2 * np.sqrt(t / 1.0e6) / np.sqrt(0.6 / 0.6) for t in t_k
        )  # km/s, gamma=5/3 mu=0.6
        # The frozen spatial-wave product reports a point estimate without an
        # interval; the sound-speed interval still brackets the classification.
        v_prop_value = float(v_prop["estimate"])
        ratio = (v_prop_value / c_s[1], v_prop_value / c_s[0])
        if ratio[1] < 1.0:
            wave_type = "sub-sonic apparent speed: slow-mode compatible"
        elif ratio[0] > 3.0:
            wave_type = "super-sonic apparent speed: Alfvenic/fast or propagation projection effect"
        else:
            wave_type = "trans-sonic: wave type not discriminable from speed alone"
        n_e = NE_ASSUMED_CM3
        rho = tuple(MU * MP * n for n in n_e)
        # Wave energy flux upper limit for an IRIS-detectable amplitude.
        flux_upper = tuple(
            0.5 * r * (DELTA_V_DETECT_KM_S * 1.0e5) ** 2 * (v * 1.0e5)
            for r, v in zip((rho[1],), (v_prop_value,))
        )
        # Radiative loss demand per column area.
        loss_demand = tuple(
            n**2 * lam * length
            for n in (n_e[1],)
            for lam in (LAMBDA_ERG_CM3[1],)
            for length in (L_ASSUMED_CM[1],)
        )
        # Minimum velocity amplitude to close the loss demand.
        v_required = tuple(
            np.sqrt(2.0 * demand / (rho[0] * v_prop_value * 1.0e5)) / 1.0e5
            for demand in loss_demand
        )
        cases.append(
            {
                "caseId": case_id,
                "apparentPropagationSpeedKmPerSecond": {
                    "estimate": v_prop_value,
                    "interval": None,
                },
                "demLogTemperature": log_t,
                "soundSpeedKmPerSecond": c_s,
                "speedRatioToSoundSpeed": ratio,
                "waveTypeClassification": wave_type,
                "assumedDensityCm3": n_e,
                "waveEnergyFluxUpperLimitErgPerCm2PerSecond": flux_upper[0],
                "deltaVAssumedKmPerSecond": DELTA_V_DETECT_KM_S,
                "radiativeLossDemandErgPerCm2": loss_demand[0],
                "minimumDeltaVToCloseKmPerSecond": v_required[0],
                "closureVerdict": (
                    "undetermined: delta_v not measured; minimum required amplitude "
                    f"{v_required[0]:.2f} km/s vs IRIS-detectable ~10 km/s"
                ),
            }
        )

    result = {
        "schemaVersion": 1,
        "analysisVersion": ANALYSIS_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cases": cases,
        "assumptions": {
            "densityCm3": NE_ASSUMED_CM3,
            "loopHalfLengthCm": L_ASSUMED_CM,
            "radiativeLossFunctionErgCm3PerS": LAMBDA_ERG_CM3,
            "deltaV": "IRIS-detectability threshold argument, not a measured wave amplitude",
        },
        "quantitativeResults": [],
        "mechanismEvidencePermitted": False,
        "evidenceRole": "diagnostic_boundary",
        "boundaries": [
            "Automated ROI path; expert human-review of the loop path is pending "
            "(registered human_review task), so no closure claim is made.",
            "Density is a literature active-region assumption, not measured per-path.",
            "delta_v is a detectability argument; a measured wave amplitude requires "
            "time-resolved Doppler or demodulated intensity along a verified path.",
            "Wave type is classified against c_s only; projection and refraction are "
            "not corrected.",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"product written: {args.output} | cases: {len(cases)}")
    for case in cases:
        print(
            f"  {case['caseId']}: v={case['apparentPropagationSpeedKmPerSecond']['estimate']:.0f} "
            f"km/s | c_s={case['soundSpeedKmPerSecond'][0]:.0f}-{case['soundSpeedKmPerSecond'][1]:.0f} "
            f"| {case['waveTypeClassification'][:44]} | F_up={case['waveEnergyFluxUpperLimitErgPerCm2PerSecond']:.2e}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
