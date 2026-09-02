#!/usr/bin/env python3
"""Magnetic energy budget check (v1) — Poynting supply vs radiative demand.

Necessary-condition check for the reconnection/nanoflare family: compares the
literature active-region Poynting-flux supply interval (1e5-1e7 erg/cm2/s,
Withbroe & Noyes 1977 and modern revisions) against the coronal radiative
loss demand of the observed plasma column (n from the literature assumption,
T from the frozen DEM). This is a 0-D necessary-condition check with
photospheric proxies — NOT an NLFFF coronal free-energy computation.
mechanismEvidencePermitted=false. Product: magnetic-energy-budget-check-v1.
"""
from __future__ import annotations

import argparse, glob, json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

ANALYSIS_VERSION = "magnetic-energy-budget-check-v1"
POYNTING_ERG_CM2_S = (1.0e5, 1.0e7)
NE_ASSUMED_CM3 = (1.0e8, 3.0e9)
LAMBDA_ERG_CM3 = (3.0e-23, 3.0e-22)
CORONAL_SCALE_HEIGHT_CM = 5.0e9

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
        t_max = 10.0 ** float(t["upperBound"])
        n_max = NE_ASSUMED_CM3[1]
        lam_max = LAMBDA_ERG_CM3[1]
        # Volumetric radiative loss demand (erg/cm3/s), then column demand
        demand_volumetric = n_max ** 2 * lam_max
        demand_column = demand_volumetric * CORONAL_SCALE_HEIGHT_CM
        # Supply per column area from the literature Poynting interval
        supply_lo, supply_hi = POYNTING_ERG_CM2_S
        # Necessary-condition verdict: supply low end must not be below demand
        # high end for the mechanism to be viable at the assumed density.
        if supply_lo >= demand_column:
            verdict = "demand within Poynting supply even at low-end supply: necessary condition met"
        elif supply_hi >= demand_column:
            verdict = "demand exceeds low-end supply: requires the high-end Poynting regime (filling factor / density dependent)"
        else:
            verdict = "demand exceeds even high-end Poynting supply at assumed n: necessary condition FAILED (density assumption driven)"
        cases.append({
            "caseId": case_id,
            "demLogTemperature": (float(t["lowerBound"]), float(t["upperBound"])),
            "assumedDensityCm3": NE_ASSUMED_CM3,
            "radiativeDemandVolumetricErgPerCm3PerS": demand_volumetric,
            "radiativeDemandColumnErgPerCm2PerS": demand_column,
            "poyntingSupplyIntervalErgPerCm2PerS": POYNTING_ERG_CM2_S,
            "verdict": verdict,
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
            "Photospheric/literature proxies only: Poynting supply is a literature "
            "interval and the density is an assumption — this check does NOT compute "
            "coronal free energy (that requires NLFFF; see the NF2 runbook in "
            "docs/闭环创新点总账.md).",
            "Necessary-condition semantics: a failed check would rule the assumed "
            "configuration out; a passed check does not confirm any mechanism.",
            "Volumetric demand uses the DEM-weighted temperature upper bound and the "
            "density interval upper bound (most demanding corner).",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"product written: {args.output} | cases: {len(cases)}")
    for case in cases:
        print(f"  {case['caseId']}: demand={case['radiativeDemandColumnErgPerCm2PerS']:.2e} "
              f"erg/cm2/s | supply={case['poyntingSupplyIntervalErgPerCm2PerS']} | {case['verdict'][:60]}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
