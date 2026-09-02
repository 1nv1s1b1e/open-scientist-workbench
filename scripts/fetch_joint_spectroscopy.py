#!/usr/bin/env python3
"""Download and register the frozen AR 11899 IRIS/EIS spectroscopy supplement."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FORMAT = "open-scientist-joint-spectroscopy-pack-v1"
KIND = "joint-spectroscopy-iris-eis-v1"
RELATIVE_ROOT = Path("supplements", "joint-spectroscopy-ar11899-v1")
ASSETS = (
    {
        "assetId": "iris-ar11899-raster",
        "instrument": "IRIS",
        "productLevel": "level2",
        "role": "spectral-raster",
        "observedAt": "2013-11-19T10:31:15Z/2013-11-19T11:03:36Z",
        "sourceUrl": "https://www.lmsal.com/solarsoft/irisa/data/level2_compressed/2013/11/19/20131119_103115_3803257441/iris_l2_20131119_103115_3803257441_raster.tar.gz",
        "relativePath": "raw/iris/iris_l2_20131119_103115_3803257441_raster.tar.gz",
        "diagnosticLines": [
            "C II 1334/1335 Å",
            "Si IV 1393/1402 Å",
            "O IV 1399/1401 Å",
        ],
    },
    {
        "assetId": "iris-ar11899-sji-1400",
        "instrument": "IRIS",
        "productLevel": "level2",
        "role": "slit-jaw-coalignment",
        "observedAt": "2013-11-19T10:31:15Z/2013-11-19T11:03:36Z",
        "sourceUrl": "https://www.lmsal.com/solarsoft/irisa/data/level2_compressed/2013/11/19/20131119_103115_3803257441/iris_l2_20131119_103115_3803257441_SJI_1400_t000.fits.gz",
        "relativePath": "raw/iris/iris_l2_20131119_103115_3803257441_SJI_1400_t000.fits.gz",
    },
    {
        "assetId": "iris-ar11899-sji-2796",
        "instrument": "IRIS",
        "productLevel": "level2",
        "role": "slit-jaw-coalignment",
        "observedAt": "2013-11-19T10:31:20Z/2013-11-19T11:03:36Z",
        "sourceUrl": "https://www.lmsal.com/solarsoft/irisa/data/level2_compressed/2013/11/19/20131119_103115_3803257441/iris_l2_20131119_103115_3803257441_SJI_2796_t000.fits.gz",
        "relativePath": "raw/iris/iris_l2_20131119_103115_3803257441_SJI_2796_t000.fits.gz",
    },
    {
        "assetId": "hinode-eis-ar11899-level0",
        "instrument": "Hinode/EIS",
        "productLevel": "level0",
        "role": "spectral-raster-calibration-input",
        "observedAt": "2013-11-19T10:40:20Z/2013-11-19T11:59:30Z",
        "sourceUrl": "https://data.darts.isas.jaxa.jp/pub/hinode/eis/level0/2013/11/19/eis_l0_20131119_104020.fits.gz",
        "relativePath": "raw/eis/eis_l0_20131119_104020.fits.gz",
        "diagnosticLines": [
            "Fe VIII 194.663 Å",
            "Si VII 275.368 Å",
            "Si X 258.375/261.058 Å",
            "Fe XII 195.119 Å",
            "Fe XIII 202.044 Å",
            "Fe XIV 264.787 Å",
        ],
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def content_length(url: str) -> int:
    result = subprocess.run(
        [
            "curl.exe",
            "-L",
            "--retry",
            "4",
            "--retry-all-errors",
            "--connect-timeout",
            "20",
            "--max-time",
            "120",
            "-fsSI",
            url,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=150,
    )
    values = [
        line.split(":", 1)[1].strip()
        for line in result.stdout.splitlines()
        if line.lower().startswith("content-length:")
    ]
    if not values or int(values[-1]) <= 0:
        raise RuntimeError(f"missing Content-Length for {url}")
    return int(values[-1])


def download(root: Path, asset: dict[str, Any]) -> dict[str, Any]:
    destination = root / str(asset["relativePath"])
    expected = int(asset["bytes"])
    if destination.is_file() and destination.stat().st_size == expected:
        return {**asset, "sha256": sha256(destination), "downloadStatus": "verified"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.unlink(missing_ok=True)
    subprocess.run(
        [
            "curl.exe",
            "-L",
            "--retry",
            "5",
            "--retry-all-errors",
            "--connect-timeout",
            "20",
            "--max-time",
            "1800",
            "-fsS",
            "-o",
            str(temporary),
            str(asset["sourceUrl"]),
        ],
        check=True,
        timeout=1860,
    )
    if temporary.stat().st_size != expected:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"byte mismatch for {asset['assetId']}")
    temporary.replace(destination)
    return {**asset, "sha256": sha256(destination), "downloadStatus": "verified"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root-manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    dataset_root = args.dataset_root.resolve()
    supplement_root = dataset_root / RELATIVE_ROOT
    manifest_path = supplement_root / "manifest.json"

    assets = []
    for asset in ASSETS:
        local_path = supplement_root / str(asset["relativePath"])
        # A completed local asset is authoritative for an offline re-registration.
        # This avoids making a transient TLS/HEAD failure invalidate already
        # downloaded, subsequently SHA-256-verified evidence.
        byte_count = local_path.stat().st_size if local_path.is_file() else content_length(
            str(asset["sourceUrl"])
        )
        assets.append({**asset, "bytes": byte_count})
    if args.plan:
        print(
            json.dumps(
                {
                    "assetCount": len(assets),
                    "bytes": sum(int(asset["bytes"]) for asset in assets),
                    "assets": assets,
                },
                ensure_ascii=True,
            )
        )
        return 0

    verified: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(download, supplement_root, asset): asset for asset in assets}
        for future in as_completed(futures):
            verified.append(future.result())
            print(f"verified spectroscopy {len(verified)}/{len(assets)}", flush=True)
    verified.sort(key=lambda item: str(item["assetId"]))
    registered_assets = [
        {
            **asset,
            "relativePath": (RELATIVE_ROOT / str(asset["relativePath"])).as_posix(),
        }
        for asset in verified
    ]
    total_bytes = sum(int(asset["bytes"]) for asset in registered_assets)
    manifest = {
        "format": FORMAT,
        "kind": KIND,
        "generatedAt": utc_now(),
        "complete": True,
        "caseId": "ar11899-joint-spectroscopy-20131119",
        "analysisSplit": "holdout",
        "selectionFrozenBeforeAnalysis": True,
        "sourceCatalogs": [
            "https://iris.lmsal.com/data.html",
            "https://www.lmsal.com/hek/hcr?cmd=submit-search-events2&startTime=2013-11-19&stopTime=2013-11-20&instrument=IRIS",
            "https://data.darts.isas.jaxa.jp/pub/hinode/eis/level0/2013/11/19/",
        ],
        "calibrationBoundary": {
            "IRIS": "Level-2 products are eligible for local spectral fitting after header/WCS checks.",
            "Hinode/EIS": "Level-0 is calibration input only; it cannot create quantitative support until a versioned EIS calibration produces a checked Level-1 product.",
        },
        "assets": registered_assets,
        "assetCount": len(registered_assets),
        "plannedTotalBytes": total_bytes,
        "bytes": total_bytes,
    }
    atomic_json(manifest_path, manifest)

    root_manifest_path = args.root_manifest.resolve()
    root_manifest = json.loads(root_manifest_path.read_text(encoding="utf-8"))
    reference = {
        "kind": KIND,
        "format": FORMAT,
        "relativePath": manifest_path.relative_to(dataset_root).as_posix(),
        "sha256": sha256(manifest_path),
        "complete": True,
        "assetCount": manifest["assetCount"],
        "requestedAssetCount": len(ASSETS),
        "bytes": manifest["bytes"],
        "generatedAt": manifest["generatedAt"],
    }
    supplements = [
        item
        for item in root_manifest.get("dataSupplements", [])
        if item.get("kind") != KIND
    ]
    root_manifest["dataSupplements"] = [*supplements, reference]
    root_manifest["supplementalBytes"] = sum(
        int(item.get("bytes", 0)) for item in root_manifest["dataSupplements"]
    )
    root_manifest["totalBytesIncludingSupplements"] = int(
        root_manifest.get("plannedTotalBytes", 0)
    ) + int(root_manifest["supplementalBytes"])
    atomic_json(root_manifest_path, root_manifest)
    print(json.dumps(reference, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
