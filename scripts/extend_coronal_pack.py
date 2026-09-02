#!/usr/bin/env python3
"""Incrementally append new, pre-registered SDO cases to a verified pack.

The normal collector rebuilds a catalog from the full specification.  This
utility is intentionally conservative: it queries only case IDs absent from
the current manifest, preflights the combined byte budget, downloads and
checksums only new assets, then atomically updates the primary manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from fetch_coronal_starter import (
    build_manifest,
    collect_logical_observations,
    download_asset,
    json_dump,
    load_collection_spec,
    pack_summary,
    preflight_assets,
    utc_now,
)


def merge_assets(
    current: list[dict[str, Any]], additions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_url = {str(asset["sourceUrl"]): asset for asset in current}
    for addition in additions:
        url = str(addition["sourceUrl"])
        existing = by_url.get(url)
        if existing is None:
            by_url[url] = addition
            continue
        existing["caseIds"] = sorted(
            set(existing.get("caseIds", [])) | set(addition.get("caseIds", []))
        )
        existing["logicalIds"] = sorted(
            set(existing.get("logicalIds", [])) | set(addition.get("logicalIds", []))
        )
        existing["queries"] = sorted(
            set(existing.get("queries", [])) | set(addition.get("queries", []))
        )
    return sorted(by_url.values(), key=lambda asset: str(asset["sourceUrl"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--download-workers", type=int, default=12)
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    dataset_root = args.dataset_root.resolve()
    spec_path = args.spec.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dataset_id, requested_cases, budget_bytes = load_collection_spec(spec_path)
    if dataset_id != manifest.get("datasetId"):
        raise SystemExit(
            f"dataset ID mismatch: {dataset_id!r} != {manifest.get('datasetId')!r}"
        )

    existing_ids = {str(case["caseId"]) for case in manifest.get("cases", [])}
    missing_cases = tuple(
        case for case in requested_cases if str(case["caseId"]) not in existing_ids
    )
    if not missing_cases:
        print("no missing cases; manifest already covers the requested specification")
        return 0

    print(
        "querying only missing cases: "
        + ", ".join(str(case["caseId"]) for case in missing_cases),
        flush=True,
    )
    logical = collect_logical_observations(missing_cases)
    cache_path = dataset_root / ".preflight-sizes.json"
    new_assets = preflight_assets(logical, args.workers, cache_path)
    extension = build_manifest(
        logical,
        new_assets,
        budget_bytes,
        dataset_id,
        missing_cases,
        spec_path,
    )
    merged_assets = merge_assets(list(manifest.get("assets", [])), new_assets)
    total_bytes = sum(int(asset["bytes"]) for asset in merged_assets)
    if total_bytes > budget_bytes:
        raise SystemExit(
            f"combined preflight is {total_bytes} bytes and exceeds budget {budget_bytes}"
        )
    print(
        f"extension preflight: {len(new_assets)} assets, "
        f"{sum(int(asset['bytes']) for asset in new_assets) / 1_000_000_000:.3f} GB; "
        f"combined {total_bytes / 1_000_000_000:.3f} GB",
        flush=True,
    )
    if args.plan:
        plan_path = manifest_path.with_name("manifest.extension.plan.json")
        json_dump(plan_path, extension)
        print(f"wrote {plan_path}")
        return 0

    with ThreadPoolExecutor(max_workers=args.download_workers) as executor:
        futures = [
            executor.submit(download_asset, dataset_root, asset, ())
            for asset in new_assets
        ]
        for index, future in enumerate(as_completed(futures), start=1):
            future.result()
            if index % 5 == 0 or index == len(futures):
                print(f"extension download {index}/{len(futures)}", flush=True)

    manifest["generatedAt"] = utc_now()
    manifest["collectionSpec"] = {
        "path": str(spec_path),
        "sha256": hashlib.sha256(spec_path.read_bytes()).hexdigest(),
    }
    manifest["budgetBytes"] = budget_bytes
    manifest["cases"] = [*manifest.get("cases", []), *extension["cases"]]
    manifest["assets"] = merged_assets
    manifest["plannedTotalBytes"] = total_bytes
    manifest["uniqueAssetCount"] = len(merged_assets)
    manifest["logicalObservationCount"] = sum(
        len(case.get("observations", [])) for case in manifest["cases"]
    )
    manifest["caseCount"] = len(manifest["cases"])
    if manifest.get("supplementalBytes") is not None:
        manifest["totalBytesIncludingSupplements"] = total_bytes + int(
            manifest.get("supplementalBytes", 0)
        )
    json_dump(manifest_path, manifest)
    print("primary manifest updated: " + pack_summary(manifest), flush=True)

    metadata_script = Path(__file__).with_name("enrich_hmi_metadata.py")
    subprocess.run(
        [
            sys.executable,
            str(metadata_script),
            "--manifest",
            str(manifest_path),
            "--dataset-root",
            str(dataset_root),
            "--strict",
        ],
        check=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
