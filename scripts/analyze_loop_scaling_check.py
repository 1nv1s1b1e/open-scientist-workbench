#!/usr/bin/env python3
"""Loop scaling-law forward check (v1) — RTV static-equilibrium consistency.

Given the frozen DEM temperature interval and the assumed density/loop-length
intervals, computes the Rosner-Tucker-Vaiana (1978) static loop prediction
T_RTV = 1.43e3 * (p L)^(1/4) MK (p in dyne/cm^2 from 2 n_e k_B T, L in cm)
and reports the deviation factor T_obs / T_RTV. This is a 0-D forward check
of the static-equilibrium hypothesis, NOT an observation-matched MHD forward
model. mechanismEvidencePermitted=false. Product: loop-scaling-forward-check-v1.
"""
from __future__ import annotations

import argparse, glob, json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

ANALYSIS_VERSION = "loop-scaling-forward-check-v1"
NE_ASSUMED_CM3 = (1.0e8, 3.0e9)
L_ASSUMED_CM = (2.5e9, 5.0e9)
K_B = 1.380649e-16

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis-v4-glob", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    cases = []
    for path in sorted(glob.glob(args.analysis_v4_glob)):
        metrics = json.loads(Path(path).read_text(encoding="utf-8"))
        case_id = metrics.get("target", {}).get("caseId", Path(path).parent.name)
        dem = metrics.get("diagnostics", {}).get("dem_temperature", {})
        t = next((q for q in dem.get("quantitativeResults", [])
                  if q.get("metric") == "aia_dem_em_weighted_log10_temperature"), None)
        if t is None or t.get("lowerBound") is None:
            continue
        log_t = (float(t["lowerBound"]), float(t["upperBound"]))
        t_obs = (10.0 ** log_t[0], 10.0 ** log_t[1])
        # T_RTV = 1.43e3 (p L)^(1/4), p = 2 n_e k_B T (dyne/cm^2), L in cm
        t_rtv = []
        for n_e in NE_ASSUMED_CM3:
            for length in L_ASSUMED_CM:
                for temp in t_obs:
                    p_pressure = 2.0 * n_e * K_B * temp
                    t_rtv.append(1.43e3 * (p_pressure * length) ** 0.25)
        t_rtv_interval = (min(t_rtv), max(t_rtv))
        # deviation factor T_obs / T_RTV per interval corner
        dev_lo = t_obs[0] / t_rtv_interval[1]
        dev_hi = t_obs[1] / t_rtv_interval[0]
        if dev_hi < 1.0:
            verdict = "T_obs below RTV band: plasma is cooler than static equilibrium with assumed n,L"
        elif dev_lo > 1.0:
            verdict = "T_obs above RTV band: plasma is hotter than static equilibrium (impulsive/dynamic heating regime)"
        else:
            verdict = "T_obs inside RTV band: static-equilibrium scaling compatible (within assumed n,L intervals)"
        cases.append({
            "caseId": case_id,
            "observedLogTemperature": log_t,
            "rtvPredictedTemperatureK": t_rtv_interval,
            "deviationFactorTObsOverTRtv": [dev_lo, dev_hi],
            "verdict": verdict,
            "assumptions": {"densityCm3": NE_ASSUMED_CM3, "loopHalfLengthCm": L_ASSUMED_CM},
        })

    result = {
        "schemaVersion": 1,
        "analysisVersion": ANALYSIS_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cases": cases,
        "quantitativeResults": [],
        "mechanismEvidencePermitted": False,
        "evidenceRole": "diagnostic_boundary",
        "boundaries": [
            "0-D RTV static scaling check with assumed density and loop half-length "
            "intervals; it is NOT an observation-matched MHD forward model.",
            "A single DEM-weighted temperature is compared; differential emission "
            "measure shape is not re-fitted.",
            "Deviation from RTV indicates the static-equilibrium assumption fails for "
            "the assumed n,L — it is not by itself mechanism evidence.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"product written: {args.output} | cases: {len(cases)}")
    for case in cases:
        print(f"  {case['caseId']}: T_obs={case['observedLogTemperature']} | "
              f"T_RTV={case['rtvPredictedTemperatureK'][0]:.0f}-{case['rtvPredictedTemperatureK'][1]:.0f} K | "
              f"dev=[{case['deviationFactorTObsOverTRtv'][0]:.2f},{case['deviationFactorTObsOverTRtv'][1]:.2f}] {case['verdict'][:52]}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
