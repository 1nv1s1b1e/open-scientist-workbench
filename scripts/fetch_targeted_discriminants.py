#!/usr/bin/env python3
"""Download checksummed, mechanism-discriminating solar data supplements.

The supplement deliberately contains a small number of event-matched products:

* calibrated Hinode/EIS level-1 data for the existing AR 11899 holdout;
* the published AR 11890 IRIS nanoflare-footpoint observation; and
* calibrated NuSTAR level-2 event lists plus livetime/attitude inputs for two
  independent hard-X-ray campaigns.

The files are evidence inputs, not mechanism labels.  Registering them never
promotes a hypothesis by itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


FORMAT = "open-scientist-targeted-discriminants-pack-v1"
KIND = "targeted-discriminants-hxr-spectroscopy-v1"
RELATIVE_ROOT = Path("supplements", "targeted-discriminants-v1")


def iris_assets() -> list[dict[str, Any]]:
    observation = "20131109_120415_3860257403"
    base = (
        "https://www.lmsal.com/solarsoft/irisa/data/level2_compressed/"
        f"2013/11/09/{observation}/"
    )
    return [
        {
            "assetId": "iris-ar11890-raster",
            "caseId": "ar11890-nanoflare-footpoints-20131109",
            "instrument": "IRIS",
            "productLevel": "level2",
            "role": "spectral-raster",
            "observedAt": "2013-11-09T12:04:15Z/2013-11-09T12:17:26Z",
            "sourceUrl": f"{base}iris_l2_{observation}_raster.tar.gz",
            "relativePath": f"raw/iris/{observation}/iris_l2_{observation}_raster.tar.gz",
        },
        {
            "assetId": "iris-ar11890-sji-1400",
            "caseId": "ar11890-nanoflare-footpoints-20131109",
            "instrument": "IRIS",
            "productLevel": "level2",
            "role": "slit-jaw-coalignment",
            "observedAt": "2013-11-09T12:04:15Z/2013-11-09T12:17:26Z",
            "sourceUrl": f"{base}iris_l2_{observation}_SJI_1400_t000.fits.gz",
            "relativePath": f"raw/iris/{observation}/iris_l2_{observation}_SJI_1400_t000.fits.gz",
        },
        {
            "assetId": "iris-ar11890-sji-2796",
            "caseId": "ar11890-nanoflare-footpoints-20131109",
            "instrument": "IRIS",
            "productLevel": "level2",
            "role": "slit-jaw-coalignment",
            "observedAt": "2013-11-09T12:04:15Z/2013-11-09T12:17:26Z",
            "sourceUrl": f"{base}iris_l2_{observation}_SJI_2796_t000.fits.gz",
            "relativePath": f"raw/iris/{observation}/iris_l2_{observation}_SJI_2796_t000.fits.gz",
        },
    ]


def eis_assets() -> list[dict[str, Any]]:
    base = "https://umbra.nascom.nasa.gov/hinode/eis/level1/hdf5/2013/11/19/"
    common = {
        "caseId": "ar11899-joint-spectroscopy-20131119",
        "instrument": "Hinode/EIS",
        "productLevel": "level1-hdf5",
        "observedAt": "2013-11-19T10:40:20Z/2013-11-19T11:59:30Z",
    }
    return [
        {
            **common,
            "assetId": "eis-ar11899-level1-data",
            "role": "calibrated-spectral-data",
            "sourceUrl": f"{base}eis_20131119_104020.data.h5",
            "relativePath": "calibrated/eis/eis_20131119_104020.data.h5",
        },
        {
            **common,
            "assetId": "eis-ar11899-level1-header",
            "role": "calibration-and-pointing-header",
            "sourceUrl": f"{base}eis_20131119_104020.head.h5",
            "relativePath": "calibrated/eis/eis_20131119_104020.head.h5",
        },
    ]


def nustar_assets() -> list[dict[str, Any]]:
    campaigns = (
        {
            "caseId": "ar12222-nustar-postflare-20141211",
            "obsid": "20001005001",
            "archiveCycle": "00",
            "observedAt": "2014-12-11T18:21:10Z/2014-12-11T19:06:06Z",
            "split": "external_holdout",
        },
        {
            "caseId": "nustar-microflare-20180909",
            "obsid": "80414201001",
            "archiveCycle": "04",
            "observedAt": "2018-09-09T08:31:12Z/2018-09-09T10:06:06Z",
            "split": "external_holdout",
        },
        {
            "caseId": "nustar-microflare-20180909",
            "obsid": "80414202001",
            "archiveCycle": "04",
            "observedAt": "2018-09-09T10:06:06Z/2018-09-09T11:41:10Z",
            "split": "external_holdout",
        },
        {
            "caseId": "nustar-microflare-20180909",
            "obsid": "80414203001",
            "archiveCycle": "04",
            "observedAt": "2018-09-09T11:41:10Z/2018-09-09T13:11:08Z",
            "split": "external_holdout",
        },
    )
    assets: list[dict[str, Any]] = []
    for campaign in campaigns:
        obsid = str(campaign["obsid"])
        # NASA publishes the HEASARC mirror as an anonymous public-data S3
        # bucket.  The HTTP object endpoint is used here because Windows
        # Schannel intermittently terminates long HEASARC HTTPS transfers;
        # exact byte counts and local SHA-256 values are always enforced.
        root = (
            "http://nasa-heasarc.s3.amazonaws.com/nustar/data/obs/"
            f"{campaign['archiveCycle']}/{obsid[0]}/{obsid}/"
        )
        common = {
            "caseId": campaign["caseId"],
            "analysisSplit": campaign["split"],
            "instrument": "NuSTAR",
            "obsid": obsid,
            "observedAt": campaign["observedAt"],
        }
        for module in ("A", "B"):
            for mode in ("02", "03", "06"):
                filename = f"nu{obsid}{module}{mode}_cl.evt.gz"
                assets.append(
                    {
                        **common,
                        "assetId": f"nustar-{obsid}-{module.lower()}{mode}-events",
                        "productLevel": "level2-cleaned-events",
                        "role": "calibrated-event-list",
                        "sourceUrl": f"{root}event_cl/{filename}",
                        "relativePath": f"calibrated/nustar/{obsid}/event_cl/{filename}",
                    }
                )
            for suffix, role in ((".mkf.gz", "filter-and-livetime"), (".attorb.gz", "attitude-orbit")):
                filename = f"nu{obsid}{module}{suffix}"
                assets.append(
                    {
                        **common,
                        "assetId": f"nustar-{obsid}-{module.lower()}-{role}",
                        "productLevel": "level2-ancillary",
                        "role": role,
                        "sourceUrl": f"{root}event_cl/{filename}",
                        "relativePath": f"calibrated/nustar/{obsid}/event_cl/{filename}",
                    }
                )
            hk_name = f"nu{obsid}{module}_fpm.hk.gz"
            assets.append(
                {
                    **common,
                    "assetId": f"nustar-{obsid}-{module.lower()}-housekeeping",
                    "productLevel": "housekeeping",
                    "role": "livetime-housekeeping",
                    "sourceUrl": f"{root}hk/{hk_name}",
                    "relativePath": f"calibrated/nustar/{obsid}/hk/{hk_name}",
                }
            )
        for filename, role in (
            (f"nu{obsid}_att.fits.gz", "corrected-attitude"),
            (f"nu{obsid}_orb.fits.gz", "orbit"),
        ):
            assets.append(
                {
                    **common,
                    "assetId": f"nustar-{obsid}-{role}",
                    "productLevel": "auxiliary",
                    "role": role,
                    "sourceUrl": f"{root}auxil/{filename}",
                    "relativePath": f"calibrated/nustar/{obsid}/auxil/{filename}",
                }
            )
    return assets


ASSETS = tuple([*iris_assets(), *eis_assets(), *nustar_assets()])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


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
            "180",
            "-fsSI",
            url,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=210,
    )
    lengths = [
        line.split(":", 1)[1].strip()
        for line in result.stdout.splitlines()
        if line.lower().startswith("content-length:")
    ]
    if not lengths or int(lengths[-1]) <= 0:
        raise RuntimeError(f"missing Content-Length for {url}")
    return int(lengths[-1])


def download(root: Path, asset: dict[str, Any]) -> dict[str, Any]:
    destination = root / str(asset["relativePath"])
    expected = int(asset["bytes"])
    if destination.is_file() and destination.stat().st_size == expected:
        return {**asset, "sha256": sha256(destination), "downloadStatus": "verified"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    last_error: Exception | None = None
    for attempt in range(10):
        offset = temporary.stat().st_size if temporary.is_file() else 0
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        try:
            with requests.get(
                str(asset["sourceUrl"]),
                headers=headers,
                stream=True,
                timeout=(30, 120),
            ) as response:
                response.raise_for_status()
                if offset and response.status_code != 206:
                    # The host ignored Range. Restart once rather than append a
                    # complete response to a partial file.
                    temporary.unlink(missing_ok=True)
                    continue
                mode = "ab" if offset else "wb"
                with temporary.open(mode) as handle:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            handle.write(chunk)
            if temporary.stat().st_size == expected:
                break
            last_error = RuntimeError(
                f"partial byte count {temporary.stat().st_size} != {expected}"
            )
        except Exception as error:  # preserve the partial file and resume
            last_error = error
        time.sleep(min(2**attempt, 20))
    else:
        raise RuntimeError(f"download failed for {asset['assetId']}: {last_error}")
    if temporary.stat().st_size != expected:
        raise RuntimeError(f"byte mismatch for {asset['assetId']}")
    temporary.replace(destination)
    return {**asset, "sha256": sha256(destination), "downloadStatus": "verified"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root-manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    dataset_root = args.dataset_root.resolve()
    supplement_root = dataset_root / RELATIVE_ROOT
    manifest_path = supplement_root / "manifest.json"
    existing_analysis_products: list[dict[str, Any]] = []
    preserved_calibrations: list[dict[str, Any]] = []
    if manifest_path.is_file():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        existing_analysis_products = existing_manifest.get("analysisProducts", [])
        # Derived atomic-response calibrations registered by build scripts are
        # not downloaded assets; keep them when the download registry is rebuilt.
        preserved_calibrations = [
            row
            for row in existing_manifest.get("calibrations", [])
            if row.get("productLevel") not in (None, "level1-hdf5")
        ]

    planned: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for asset in ASSETS:
        local_path = supplement_root / str(asset["relativePath"])
        if local_path.is_file():
            planned.append({**asset, "bytes": local_path.stat().st_size})
        else:
            missing.append(asset)
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        futures = {
            executor.submit(content_length, str(asset["sourceUrl"])): asset
            for asset in missing
        }
        for future in as_completed(futures):
            asset = futures[future]
            planned.append({**asset, "bytes": future.result()})
    planned.sort(key=lambda item: str(item["assetId"]))
    if args.plan:
        print(
            json.dumps(
                {
                    "assetCount": len(planned),
                    "bytes": sum(int(asset["bytes"]) for asset in planned),
                    "assets": planned,
                },
                ensure_ascii=True,
            )
        )
        return 0

    verified: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        futures = {
            executor.submit(download, supplement_root, asset): asset for asset in planned
        }
        for future in as_completed(futures):
            verified.append(future.result())
            print(f"verified targeted asset {len(verified)}/{len(planned)}", flush=True)
    verified.sort(key=lambda item: str(item["assetId"]))
    registered = [
        {
            **asset,
            "relativePath": (RELATIVE_ROOT / str(asset["relativePath"])).as_posix(),
        }
        for asset in verified
    ]
    total_bytes = sum(int(asset["bytes"]) for asset in registered)
    calibrations = [
        {
            "instrument": "Hinode/EIS",
            "productId": str(asset["assetId"]),
            "productLevel": str(asset["productLevel"]),
            "calibrationVersion": "hinode-eis-archive-level1-hdf5",
            "checksumAlgorithm": "sha256",
            "checksum": str(asset["sha256"]),
            "validFrom": str(asset["observedAt"]).split("/", 1)[0],
            "analysisSoftwareRequired": "eispac==0.99.4",
        }
        for asset in registered
        if asset.get("instrument") == "Hinode/EIS"
        and asset.get("productLevel") == "level1-hdf5"
    ]
    manifest = {
        "format": FORMAT,
        "kind": KIND,
        "generatedAt": utc_now(),
        "complete": True,
        "selectionFrozenBeforeAnalysis": True,
        "caseCount": len({str(asset["caseId"]) for asset in registered}),
        "sourceCatalogs": [
            "https://www.lmsal.com/hek/hcr",
            "https://umbra.nascom.nasa.gov/hinode/eis/level1/",
            "https://heasarc.gsfc.nasa.gov/W3Browse/nustar/numaster.html",
            "https://heasarc.gsfc.nasa.gov/FTP/nustar/data/obs/",
            "https://registry.opendata.aws/nasa-heasarc/",
        ],
        "calibrations": sorted(
            [*preserved_calibrations, *calibrations],
            key=lambda row: str(row.get("productId", "")),
        ),
        "calibrationRegistryComplete": len(calibrations) == 2,
        "analysisProducts": existing_analysis_products,
        "scientificBoundary": {
            "statement": (
                "The supplement adds calibrated inputs for independent spectroscopy and "
                "hard-X-ray tests. It does not transfer evidence between events and does not "
                "assign a coronal-heating mechanism label."
            ),
            "nustar": (
                "Level-2 events support livetime-aware count-rate products with limb-validated "
                "source/background geometry and ghost-ray audits; physical flux still requires "
                "a response-matrix spectral fit (CALDB) and roll-referenced solar coordinates "
                "require the binary-table WCS keywords these 2014-era headers lack."
            ),
            "iris": (
                "AR11890 is a literature-anchored positive-control event; any local criterion "
                "must remain visibly separate from a blind holdout claim."
            ),
            "eis": (
                "The HDF5 pair is calibrated Level-1 input. Density, Doppler and non-thermal "
                "width products use versioned line fitting, the registered CHIANTI density "
                "curve and frozen instrumental widths; mechanism use still requires "
                "cross-event replication."
            ),
        },
        "assets": registered,
        "assetCount": len(registered),
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
        "assetCount": len(registered),
        "requestedAssetCount": len(ASSETS),
        "bytes": total_bytes,
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
