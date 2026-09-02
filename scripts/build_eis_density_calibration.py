#!/usr/bin/env python3
"""Freeze the CHIANTI Si X 258.375/261.058 emissivity-ratio density curve.

The EIS analysis consumes a versioned ratio-to-density curve instead of an
on-the-fly atomic calculation.  This builder computes that curve once with
the official CHIANTI database and ChiantiPy, validates it against a
published anchor, and registers it in the targeted-discriminants supplement
manifest so `analyze_eis_level1.py` can checksum-verify it at runtime.

Steps:
1. download the minimal CHIANTI Si X model (plus the root files ChiantiPy
   needs at import time) into a scratch database directory;
2. solve the level populations at log T = 6.05/6.10/6.15 over
   log Ne = 7.00-11.00 (step 0.05) including proton impact rates;
3. validate the curve against the published quiet-Sun anchor
   (Warren 2009: observed ratio 1.645 -> log Ne = 8.35 with CHIANTI 5.2.1);
4. write `sources/eis-si10-density-curve-v1.json` and register its SHA-256
   in the supplement `calibrations[]` registry.

Requires the ``ChiantiPy`` package (see README section "EIS density
calibration").  Re-running with the same database reproduces the file
byte-for-byte; a different database version is rejected unless --force.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


CHIANTI_BASE = (
    "https://sohoftp.nascom.nasa.gov/solarsoft/packages/chianti/dbase"
)
CHIANTI_FILES = (
    "VERSION",
    "abundance/sun_photospheric_2021_asplund.abund",
    "ioneq/chianti.ioneq",
    "ioneq/grndLevels.dat",
    "ip/chianti.ip",
    "masterlist/masterlist.ions",
    "continuum/verner_short.txt",
    "continuum/gffgu.dat",
    "continuum/gffint.dat",
    "continuum/hseq_2photon.dat",
    "continuum/klgfb_1.dat",
    "continuum/klgfb_2.dat",
    "continuum/klgfb_3.dat",
    "continuum/klgfb_4.dat",
    "continuum/klgfb_5.dat",
    "continuum/klgfb_6.dat",
    "si/si_10/si_10.elvlc",
    "si/si_10/si_10.scups",
    "si/si_10/si_10.wgfa",
    "si/si_10/si_10.psplups",
    "si/si_11/si_11.elvlc",
    "si/si_11/si_11.rrparams",
    "si/si_11/si_11.drparams",
    "si/si_11/si_11.fblvl",
)
PRIMARY_LOG_T = 6.10
LOG_T_GRID = (6.05, 6.10, 6.15)
LOG_NE_GRID = np.round(np.arange(70, 110.1, 5), 1) / 10.0
TRANSITION_258 = {"targetAngstrom": 258.375}
TRANSITION_261 = {"targetAngstrom": 261.058}
# Warren, H. P. 2009, ApJ, 700, 762 (Table 2 quiet-Sun off-limb ratio
# 1.645 +/- 0.0064, inverted there to log Ne = 8.35 with CHIANTI 5.2.1).
ANCHOR_RATIO = 1.645
ANCHOR_LOG_NE_PUBLISHED = 8.35
ANCHOR_MAX_DEVIATION_DEX = 0.5


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


def ensure_database(scratch: Path, download: bool) -> dict[str, str]:
    for relative in CHIANTI_FILES:
        path = scratch / relative
        if path.is_file():
            continue
        if not download:
            raise SystemExit(
                f"CHIANTI file {relative} missing in {scratch}; re-run with --download"
            )
        url = f"{CHIANTI_BASE}/{relative}"
        result = subprocess.run(
            ["curl.exe", "-sL", "--retry", "4", "--retry-all-errors",
             "--connect-timeout", "20", "--max-time", "300", "-f", "-o", str(path), url],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not path.is_file() or path.stat().st_size == 0:
            raise SystemExit(f"failed to download {url}")
    digests = {relative: sha256(scratch / relative) for relative in CHIANTI_FILES}
    version = (scratch / "VERSION").read_text(encoding="utf-8").strip()
    return {"version": version, "files": digests}


def compute_curve(scratch: Path) -> dict[str, Any]:
    os.environ["XUVTOP"] = str(scratch)
    try:
        import ChiantiPy.core as ch
        from ChiantiPy.tools import data as chdata
        import importlib.metadata as importlib_metadata
    except ImportError as error:  # pragma: no cover - environment specific
        raise SystemExit(
            "ChiantiPy is required to build the EIS density calibration. "
            "Install it with: corepack pnpm venv python -m pip install ChiantiPy "
            f"(original error: {error})"
        ) from error
    if chdata.Defaults["flux"] != "energy":
        raise SystemExit("ChiantiPy must be configured with flux=energy units")

    densities = 10.0**LOG_NE_GRID
    curves: dict[str, Any] = {}
    transitions: dict[str, Any] | None = None
    for log_t in LOG_T_GRID:
        temperature = np.array([10.0**log_t])
        ion = ch.ion("si_10", temperature=temperature, eDensity=densities)
        # ChiantiPy 0.16 stores PDensity as (1, Ndens) but indexes it as a flat
        # array inside populateDens; flatten so proton rates enter the matrix.
        ion.PDensity = np.asarray(ion.PDensity, dtype=float).ravel()
        ion.populate(popCorrect=False)
        ion.emiss()
        emiss = ion.Emiss
        wavelengths = np.asarray(emiss["wvl"], dtype=float)
        index_258 = int(np.argmin(np.abs(wavelengths - TRANSITION_258["targetAngstrom"])))
        index_261 = int(np.argmin(np.abs(wavelengths - TRANSITION_261["targetAngstrom"])))
        if abs(wavelengths[index_258] - TRANSITION_258["targetAngstrom"]) > 0.02:
            raise SystemExit("no Si X transition found near 258.375 A")
        if abs(wavelengths[index_261] - TRANSITION_261["targetAngstrom"]) > 0.02:
            raise SystemExit("no Si X transition found near 261.058 A")
        transitions = {
            "line258": {
                "chiantiWavelengthAngstrom": float(wavelengths[index_258]),
                "lowerLevel": int(emiss["lvl1"][index_258]),
                "upperLevel": int(emiss["lvl2"][index_258]),
            },
            "line261": {
                "chiantiWavelengthAngstrom": float(wavelengths[index_261]),
                "lowerLevel": int(emiss["lvl1"][index_261]),
                "upperLevel": int(emiss["lvl2"][index_261]),
            },
        }
        ratio = (
            np.asarray(emiss["emiss"], dtype=float)[index_258]
            / np.asarray(emiss["emiss"], dtype=float)[index_261]
        )
        if not np.all(np.diff(ratio) > 0):
            raise SystemExit(f"Si X ratio curve is not strictly monotone at log T={log_t}")
        curves[f"{log_t:.2f}"] = [float(round(value, 6)) for value in ratio]

    return {
        "chiantiPyVersion": importlib_metadata.version("ChiantiPy"),
        "curves": curves,
        "transitions": transitions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch-dir", type=Path, default=Path(".tmp/chianti-db"))
    parser.add_argument("--root-manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("sources/eis-si10-density-curve-v1.json"))
    parser.add_argument("--download", action="store_true", help="download missing CHIANTI files")
    parser.add_argument("--force", action="store_true", help="overwrite an existing curve file")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    scratch = args.scratch_dir.resolve()
    output = (repo_root / args.output).resolve() if not args.output.is_absolute() else args.output
    if output.exists() and not args.force:
        raise SystemExit(f"{output} already exists; pass --force to recalibrate")

    database = ensure_database(scratch, args.download)
    computed = compute_curve(scratch)

    primary = computed["curves"][f"{PRIMARY_LOG_T:.2f}"]
    if not (primary[0] < ANCHOR_RATIO < primary[-1]):
        raise SystemExit("published anchor ratio falls outside the computed curve range")
    anchor_log_ne = float(np.interp(ANCHOR_RATIO, primary, LOG_NE_GRID))
    deviation = abs(anchor_log_ne - ANCHOR_LOG_NE_PUBLISHED)
    if deviation > ANCHOR_MAX_DEVIATION_DEX:
        raise SystemExit(
            "anchor validation failed: curve gives "
            f"{anchor_log_ne:.2f}, published {ANCHOR_LOG_NE_PUBLISHED}"
        )

    curves_out = {
        log_t: [
            {"logElectronDensityCm3": float(log_n), "intensityRatioEnergyUnits": ratio}
            for log_n, ratio in zip(LOG_NE_GRID, ratios)
        ]
        for log_t, ratios in computed["curves"].items()
    }
    document = {
        "schemaVersion": 1,
        "kind": "eis-si10-density-curve-v1",
        "analysisVersion": "eis-si10-density-curve-v1",
        "generatedAt": now(),
        "ion": "Si X",
        "diagnostic": "Si X 258.375/261.058 intensity ratio -> electron density",
        "units": {
            "intensityRatio": "energy units (erg cm-2 s-1 sr-1 per Å cancel)",
            "density": "log10(electron density, cm-3)",
        },
        "chiantiVersion": database["version"],
        "chiantiPyVersion": computed["chiantiPyVersion"],
        "levelPopulationAssumptions": [
            "Steady-state level populations from electron-impact excitation/de-excitation "
            "(CHIANTI scups) including proton impact rates (si_10.psplups).",
            "Level-resolved radiative recombination data are absent for Si X in CHIANTI "
            "(empty si_10.rrlvl), so recombination-cascade feeding is not included.",
            "Isothermal plasma at each registered log T; abundance and ionization fraction "
            "cancel in the same-ion ratio.",
            "Optically thin emission (EIS Software Note 15 method).",
        ],
        "registeredTemperatures": {
            f"{log_t:.2f}": {"assumption": "log T fixed for the emissivity calculation"}
            for log_t in LOG_T_GRID
        },
        "transitions": computed["transitions"],
        "curve": curves_out,
        "primaryTemperature": f"{PRIMARY_LOG_T:.2f}",
        "validation": {
            "anchor": {
                "source": "Warren, H. P. 2009, ApJ, 700, 762, Table 2",
                "observedIntensityRatio": ANCHOR_RATIO,
                "publishedLogElectronDensityCm3": ANCHOR_LOG_NE_PUBLISHED,
                "publishedChiantiVersion": "5.2.1",
                "thisCurveLogElectronDensityCm3": round(anchor_log_ne, 3),
                "deviationDex": round(deviation, 3),
                "maximumAllowedDeviationDex": ANCHOR_MAX_DEVIATION_DEX,
            }
        },
        "chiantiFiles": [
            {"relativePath": relative, "sha256": digest}
            for relative, digest in database["files"].items()
        ],
        "boundaries": [
            "The curve is a frozen atomic response, not an observation; it carries no event data.",
            "Density sensitivity is bounded by the registered grid; ratios outside the curve "
            "range must be reported as unconstrained, not clipped.",
            "A few-percent blend contribution in the observed 258.375 feature propagates "
            "directly into the inverted density.",
        ],
    }
    write_json(output, document)

    dataset_root = args.dataset_root.resolve()
    supplement_path = dataset_root / "supplements/targeted-discriminants-v1/manifest.json"
    supplement = json.loads(supplement_path.read_text(encoding="utf-8"))
    calibration = {
        "instrument": "Hinode/EIS",
        "productId": "eis-si10-density-curve-v1",
        "productLevel": "atomic-response-curve",
        "calibrationVersion": f"chianti-{database['version']}-si10-level-population",
        "checksumAlgorithm": "sha256",
        "checksum": sha256(output),
        "validFrom": document["generatedAt"],
        "analysisSoftwareRequired": f"ChiantiPy=={computed['chiantiPyVersion']}",
        "curveSource": output.name,
    }
    calibrations = [
        row
        for row in supplement.get("calibrations", [])
        if row.get("productId") != calibration["productId"]
    ]
    calibrations.append(calibration)
    calibrations.sort(key=lambda row: str(row.get("productId", "")))
    supplement["calibrations"] = calibrations
    supplement["calibrationRegistryComplete"] = True
    supplement["generatedAt"] = document["generatedAt"]
    write_json(supplement_path, supplement)

    root_path = args.root_manifest.resolve()
    root_manifest = json.loads(root_path.read_text(encoding="utf-8"))
    for reference in root_manifest.get("dataSupplements", []):
        if reference.get("kind") == supplement.get("kind"):
            reference["sha256"] = sha256(supplement_path)
            reference["generatedAt"] = supplement["generatedAt"]
    write_json(root_path, root_manifest)
    print(
        json.dumps(
            {
                "output": str(output),
                "sha256": calibration["checksum"],
                "chiantiVersion": database["version"],
                "anchorLogNe": round(anchor_log_ne, 3),
            },
            ensure_ascii=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
