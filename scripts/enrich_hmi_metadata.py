#!/usr/bin/env python3
"""Attach authoritative JSOC record metadata to downloaded HMI segments.

JSOC direct segment FITS files do not always repeat record keywords such as
CTYPE*, CRPIX*, BUNIT and DSUN_OBS in the image HDU.  The pixels are valid, but
without those keywords they cannot be co-registered or converted into physical
magnetic observables.  This script queries the exact record sets already named
in ``manifest.json`` and writes a checksummed, immutable sidecar.  Raw FITS
files are never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from fetch_coronal_starter import JSOC_INFO_URL, json_dump, request_json, utc_now


FORMAT = "open-scientist-jsoc-hmi-record-metadata-v1"
RELATIVE_PATH = "metadata/hmi-records-v1.json"
KEYS = (
    "T_REC",
    "T_OBS",
    "DATE__OBS",
    "QUALITY",
    "CADENCE",
    "CROTA2",
    "CRPIX1",
    "CRPIX2",
    "CDELT1",
    "CDELT2",
    "CRVAL1",
    "CRVAL2",
    "RSUN_OBS",
    "DSUN_OBS",
    "CRLT_OBS",
    "CRLN_OBS",
    "CAR_ROT",
    "DATAMIN",
    "DATAMAX",
    "DATAMEAN",
    "DATARMS",
)
SERIES_CONSTANTS = {
    "TELESCOP": "SDO/HMI",
    "INSTRUME": "HMI_COMBINED",
    "CONTENT": "MAGNETOGRAM",
    "BUNIT": "Gauss",
    "CTYPE1": "HPLN-TAN",
    "CTYPE2": "HPLT-TAN",
    "CUNIT1": "arcsec",
    "CUNIT2": "arcsec",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def query_records(dataset: str) -> list[dict[str, Any]]:
    payload = request_json(
        JSOC_INFO_URL,
        {"op": "rs_list", "ds": dataset, "key": ",".join(KEYS), "seg": "magnetogram"},
    )
    if payload.get("status") != 0:
        raise RuntimeError(f"JSOC metadata query failed ({payload.get('status')}): {dataset}")
    count = int(payload.get("count", -1))
    columns = {item.get("name"): item.get("values", []) for item in payload.get("keywords", [])}
    segment = next(
        (item for item in payload.get("segments", []) if item.get("name") == "magnetogram"),
        None,
    )
    if count < 0 or segment is None or any(len(columns.get(key, [])) != count for key in KEYS):
        raise RuntimeError(f"JSOC returned incomplete HMI metadata: {dataset}")
    rows: list[dict[str, Any]] = []
    for index in range(count):
        keywords = {key: columns[key][index] for key in KEYS}
        keywords.update(SERIES_CONSTANTS)
        rows.append(
            {
                "recordId": str(keywords["T_REC"]),
                "keywords": keywords,
                "segment": {
                    "name": "magnetogram",
                    "path": segment.get("values", [None] * count)[index],
                    "dimensions": segment.get("dims", [None] * count)[index],
                    "compression": segment.get("cparms", [None] * count)[index],
                    "bzero": segment.get("bzeros", [None] * count)[index],
                    "bscale": segment.get("bscales", [None] * count)[index],
                    "unit": "Gauss",
                },
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--dataset-root", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    dataset_root = (args.dataset_root or manifest_path.parent).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    hmi_assets = [item for item in manifest.get("assets", []) if item.get("instrument") == "SDO/HMI"]
    queries = sorted({query for asset in hmi_assets for query in asset.get("queries", [])})
    records_by_time: dict[str, dict[str, Any]] = {}
    query_by_time: dict[str, str] = {}
    failures: list[str] = []
    for index, query in enumerate(queries, start=1):
        try:
            for row in query_records(query):
                records_by_time[row["recordId"]] = row
                query_by_time[row["recordId"]] = query
            print(f"HMI metadata {index}/{len(queries)}: {query}", flush=True)
        except Exception as error:
            failures.append(f"{query}: {error}")
            if args.strict:
                raise

    asset_rows: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    for asset in hmi_assets:
        record_id = str(asset.get("observedAt", ""))
        row = records_by_time.get(record_id)
        if row is None:
            missing.append(str(asset.get("assetId")))
            continue
        asset_rows[str(asset["assetId"])] = {
            "query": query_by_time[record_id],
            "sourcePath": asset.get("sourcePath"),
            **row,
        }

    sidecar_path = dataset_root / RELATIVE_PATH
    sidecar = {
        "format": FORMAT,
        "generatedAt": utc_now(),
        "datasetId": manifest.get("datasetId"),
        "source": {
            "catalog": JSOC_INFO_URL,
            "operation": "rs_list",
            "keys": list(KEYS),
            "seriesConstants": SERIES_CONSTANTS,
        },
        "assetCount": len(asset_rows),
        "requestedAssetCount": len(hmi_assets),
        "assets": asset_rows,
        "missingAssetIds": missing,
        "queryFailures": failures,
    }
    json_dump(sidecar_path, sidecar)
    supplement = {
        "kind": "jsoc-hmi-record-metadata",
        "format": FORMAT,
        "relativePath": RELATIVE_PATH,
        "sha256": sha256(sidecar_path),
        "assetCount": len(asset_rows),
        "requestedAssetCount": len(hmi_assets),
        "complete": not missing and not failures,
        "generatedAt": sidecar["generatedAt"],
    }
    existing = [
        item
        for item in manifest.get("metadataSupplements", [])
        if item.get("kind") != supplement["kind"]
    ]
    manifest["metadataSupplements"] = [*existing, supplement]
    json_dump(manifest_path, manifest)
    print(
        json.dumps(
            {
                "sidecar": str(sidecar_path),
                "matched": len(asset_rows),
                "requested": len(hmi_assets),
                "complete": supplement["complete"],
                "sha256": supplement["sha256"],
            },
            ensure_ascii=False,
        )
    )
    return 0 if supplement["complete"] or not args.strict else 2


if __name__ == "__main__":
    raise SystemExit(main())
