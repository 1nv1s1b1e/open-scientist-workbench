#!/usr/bin/env python3
"""Physical HXR energy-flux upper limits from the frozen NuSTAR count-rate chain.

Takes the non-detection count-rate upper limits of
`nustar-hxr-solar-geometry-v2` (already livetime-corrected) and converts them
into energy-flux upper limits with the on-axis NuSTAR CALDB effective areas
(ARF), under an explicitly assumed photon power law dN/dE = K E^-Gamma:

    R_up  = K * I_A,   I_A = integral_{E1}^{E2} A_eff(E) E^-Gamma dE
    F_up  = K * integral_{E1}^{E2} E^(1-Gamma) dE   [erg/cm^2/s]

Boundaries (all explicit in the product): on-axis ARF with no off-axis or
ghost-ray correction, no RMF unfolding, assumed photon index, livetime already
applied in the count-rate chain, and the flagged FPMA/FPMB inconsistency of
ObsID 20001005001 is propagated as per-module limits (never summed).

Product: `hxr-flux-limit-v1`, mechanismEvidencePermitted=false,
evidenceRole=hxr_count_rate_chain.
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

ANALYSIS_VERSION = "hxr-flux-limit-v1"
PHOTON_INDEX = 3.0
E1, E2 = 6.0, 10.0  # hard band, keV
CALDB_BASE = "https://heasarc.gsfc.nasa.gov/FTP/caldb/data/nustar/fpm/bcf/arf/"
ARF_BY_EPOCH = {
    "2014": {"A": "nuA20100101v007.arf", "B": "nuB20100101v006.arf"},
    "2018": {"A": "nuA20180101v007.arf", "B": "nuB20100101v006.arf"},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def effective_area(arf_path: Path) -> tuple[np.ndarray, np.ndarray]:
    with fits.open(arf_path) as hdul:
        data = hdul[1].data
        energ_lo = np.asarray(data["ENERG_LO"], dtype=float)
        energ_hi = np.asarray(data["ENERG_HI"], dtype=float)
        specresp = np.asarray(data["SPECRESP"], dtype=float)
    return (energ_lo + energ_hi) / 2.0, specresp


def band_integral(arf_path: Path, gamma: float, e1: float, e2: float) -> dict[str, float]:
    e_center, a_eff = effective_area(arf_path)
    mask = (e_center >= e1) & (e_center <= e2) & (a_eff > 0)
    if int(np.count_nonzero(mask)) < 3:
        raise ValueError(f"ARF {arf_path.name} has too few samples inside {e1}-{e2} keV")
    e = e_center[mask]
    a = a_eff[mask]
    count_weight = float(np.trapezoid(a * e ** (-gamma), e))
    energy_weight = float(np.trapezoid(a * e ** (1.0 - gamma), e))
    return {"countIntegral": count_weight, "energyIntegral": energy_weight}


def flux_from_rate(rate_up: float, integrals: dict[str, float]) -> float:
    if rate_up <= 0 or integrals["countIntegral"] <= 0:
        return 0.0
    k = rate_up / integrals["countIntegral"]
    return k * integrals["energyIntegral"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geometry-product", type=Path, required=True)
    parser.add_argument("--arf-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    geometry = json.loads(args.geometry_product.read_text(encoding="utf-8"))
    observations = []
    for obs in geometry["observations"]:
        epoch = obs["dateObs"][:4]
        arfs = ARF_BY_EPOCH.get(epoch)
        if arfs is None:
            continue
        for band, band_data in obs["geometry"].get("bands", {}).items():
            if band_data.get("detection"):
                continue
            rate_up = band_data.get("countRateUpperLimitPerSecond")
            if not isinstance(rate_up, (int, float)) or rate_up <= 0:
                continue
            module_limits = {}
            for module in ("A", "B"):
                arf_path = args.arf_dir / arfs[module]
                integrals = band_integral(arf_path, PHOTON_INDEX, E1, E2)
                module_limits[module] = {
                    "arf": arfs[module],
                    "arfSha256": sha256(arf_path),
                    "countIntegralCm2": integrals["countIntegral"],
                    **{
                        "fluxUpperLimitErgPerCm2PerSecond": (
                            flux_from_rate(rate_up, integrals)
                        )
                    },
                }
            consistency = next(
                (
                    item
                    for item in geometry.get("crossModuleConsistency", [])
                    if item["obsid"] == obs["obsid"]
                ),
                None,
            )
            observations.append(
                {
                    "obsid": obs["obsid"],
                    "caseId": obs["caseId"],
                    "band": band,
                    "bandKev": [E1, E2],
                    "countRateUpperLimitPerSecond": rate_up,
                    "crossModuleConsistencyPass": (
                        consistency.get("consistencyPass") if consistency else None
                    ),
                    "moduleFluxUpperLimits": module_limits,
                    # Only cross-module-consistent observations get a combined
                    # (summed effective area) limit; flagged ones stay per-module.
                    "combinedFluxUpperLimitErgPerCm2PerSecond": (
                        sum(
                            item["fluxUpperLimitErgPerCm2PerSecond"]
                            for item in module_limits.values()
                        )
                        if consistency and consistency.get("consistencyPass")
                        else None
                    ),
                }
            )

    quantitative = []
    for item in observations:
        if item["combinedFluxUpperLimitErgPerCm2PerSecond"] is not None:
            quantitative.append(
                {
                    "metric": f"nustar_{item['obsid']}_{item['band']}_flux_upper_limit",
                    "estimate": 0.0,
                    "lowerBound": 0.0,
                    "upperBound": item["combinedFluxUpperLimitErgPerCm2PerSecond"],
                    "confidenceLevel": 0.99865,
                    "unit": "erg/cm^2/s",
                }
            )

    result = {
        "schemaVersion": 1,
        "analysisVersion": ANALYSIS_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "instrument": "NuSTAR",
        "inputProduct": str(args.geometry_product.name),
        "inputProductSha256": sha256(args.geometry_product),
        "assumptions": {
            "photonIndex": PHOTON_INDEX,
            "bandKev": [E1, E2],
            "arf": "on-axis CALDB effective area; no off-axis/ghost-ray correction",
            "rmf": "no RMF unfolding (counts-to-Flux through ARF-only integral)",
            "livetime": "already applied by the frozen count-rate chain",
            "crossModule": "flagged FPMA/FPMB observations stay per-module, never summed",
        },
        "observations": observations,
        "quantitativeResults": quantitative,
        "mechanismEvidencePermitted": False,
        "evidenceRole": "hxr_count_rate_chain",
        "physicalFluxAvailable": True,
        "boundaries": [
            "Energy-flux UPPER LIMITS under an assumed photon index (Gamma=3): a "
            "different index changes the limit linearly in the energy integral; no "
            "spectral unfolding was performed.",
            "On-axis ARF only; the ghost-ray/pointing audit of the v2 geometry chain "
            "must be consulted before any spatial interpretation.",
            "ObsID 20001005001 FPMA/FPMB count inconsistency (consistencyPass=false) "
            "is unresolved: only per-module limits are reported for it.",
            "Upper limits constrain nanoflare parameter space; a non-detection is "
            "not mechanism evidence by itself (mechanismEvidencePermitted=false).",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"product written: {args.output}")
    for item in observations:
        combined = item["combinedFluxUpperLimitErgPerCm2PerSecond"]
        per = {
            m: round(v["fluxUpperLimitErgPerCm2PerSecond"], 6)
            for m, v in item["moduleFluxUpperLimits"].items()
        }
        print(f"  {item['obsid']} {item['band']}: combined={combined and round(combined, 6)} per-module={per}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
