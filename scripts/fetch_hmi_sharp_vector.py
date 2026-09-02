#!/usr/bin/env python3
"""Download a bounded, checksummed HMI SHARP CEA vector-field supplement.

The primary coronal pack uses full-disk line-of-sight HMI magnetograms.  This
script adds event-matched Br/Bt/Bp maps, component uncertainties and the HMI
disambiguation-confidence mask without changing or duplicating the primary
manifest assets.  The supplement remains observational input: it does not
contain heating-mechanism labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


JSOC_INFO_URL = "http://jsoc.stanford.edu/cgi-bin/ajax/jsoc_info"
JSOC_FILE_ORIGIN = "https://jsoc1.stanford.edu"
FORMAT = "open-scientist-hmi-sharp-vector-pack-v1"
SUPPLEMENT_DIR = "supplements/hmi-sharp-vector-v1"
SEGMENTS = ("Br", "Bt", "Bp", "Br_err", "Bt_err", "Bp_err", "conf_disambig")
KEYS = (
    "HARPNUM",
    "NOAA_AR",
    "T_REC",
    "QUALITY",
    "CRPIX1",
    "CRPIX2",
    "CRVAL1",
    "CRVAL2",
    "CDELT1",
    "CDELT2",
    "CTYPE1",
    "CTYPE2",
    "CUNIT1",
    "CUNIT2",
    "RSUN_REF",
    "DSUN_OBS",
)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def run_curl(arguments: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "curl.exe",
            "--retry",
            "4",
            "--retry-delay",
            "2",
            "--retry-all-errors",
            *arguments,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def request_json(parameters: dict[str, str]) -> dict[str, Any]:
    url = f"{JSOC_INFO_URL}?{urlencode(parameters)}"
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            response = run_curl(["--max-time", "90", "-fsS", url], timeout=100)
            payload = json.loads(response.stdout)
            if payload.get("status") != 0:
                raise RuntimeError(
                    f"JSOC query failed ({payload.get('status')}): {parameters.get('ds')}"
                )
            return payload
        except (subprocess.SubprocessError, json.JSONDecodeError, RuntimeError) as error:
            last_error = error
            if attempt == 4:
                raise
            time.sleep(min(2**attempt, 8))
    assert last_error is not None
    raise last_error


def columns(payload: dict[str, Any], field: str) -> dict[str, list[str]]:
    return {
        str(item.get("name")): [str(value) for value in item.get("values", [])]
        for item in payload.get(field, [])
    }


def noaa_number(active_region: str) -> str:
    match = re.search(r"\d+", active_region)
    if not match:
        raise ValueError(f"active region has no NOAA number: {active_region}")
    return match.group(0)


def select_harp(case: dict[str, Any]) -> str:
    dataset = (
        f"hmi.Mharp_720s[][{case['startTai']}/{case['duration']}@720s]"
    )
    payload = request_json(
        {
            "op": "rs_list",
            "ds": dataset,
            "key": "HARPNUM,NOAA_AR,T_REC,QUALITY",
        }
    )
    keyword = columns(payload, "keywords")
    target = noaa_number(str(case["activeRegion"]))
    candidates = [
        harp
        for harp, noaa, quality in zip(
            keyword.get("HARPNUM", []),
            keyword.get("NOAA_AR", []),
            keyword.get("QUALITY", []),
            strict=True,
        )
        if target in re.findall(r"\d+", noaa) and quality == "0x00000000"
    ]
    if not candidates:
        raise RuntimeError(
            f"no HARP found for {case['caseId']} / NOAA {target} in {dataset}"
        )
    return Counter(candidates).most_common(1)[0][0]


def query_case_records(case: dict[str, Any]) -> tuple[str, str, list[dict[str, Any]]]:
    harp = select_harp(case)
    dataset = (
        f"hmi.sharp_cea_720s[{harp}]"
        f"[{case['startTai']}/{case['duration']}@720s]"
    )
    payload = request_json(
        {
            "op": "rs_list",
            "ds": dataset,
            "key": ",".join(KEYS),
            "seg": ",".join(SEGMENTS),
        }
    )
    count = int(payload.get("count", -1))
    keyword = columns(payload, "keywords")
    segment = columns(payload, "segments")
    if count <= 0:
        raise RuntimeError(f"no SHARP vector records for {case['caseId']}: {dataset}")
    required_columns = [keyword.get(key, []) for key in KEYS] + [
        segment.get(name, []) for name in SEGMENTS
    ]
    if any(len(values) != count for values in required_columns):
        raise RuntimeError(f"incomplete JSOC SHARP response for {case['caseId']}")

    records: list[dict[str, Any]] = []
    for index in range(count):
        quality = keyword["QUALITY"][index]
        paths = {name: segment[name][index] for name in SEGMENTS}
        if quality != "0x00000000" or any(not path for path in paths.values()):
            continue
        observed_at = keyword["T_REC"][index]
        record_id = f"hmi.sharp_cea_720s[{harp}][{observed_at}]"
        records.append(
            {
                "recordId": record_id,
                "observedAt": observed_at,
                "quality": quality,
                "keywords": {key: keyword[key][index] for key in KEYS},
                "segmentPaths": paths,
            }
        )
    if not records:
        raise RuntimeError(f"no QUALITY=0 SHARP vector records for {case['caseId']}")
    return harp, dataset, records


def content_length(url: str) -> int:
    response = run_curl(["--max-time", "90", "-fsSI", url], timeout=100)
    values = [
        line.split(":", 1)[1].strip()
        for line in response.stdout.splitlines()
        if line.lower().startswith("content-length:")
    ]
    if not values or int(values[-1]) <= 0:
        raise RuntimeError(f"could not determine Content-Length: {url}")
    return int(values[-1])


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def build_plan(
    root_manifest: dict[str, Any],
    root: Path,
    workers: int,
    cached_assets: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cached_assets = cached_assets or {}
    case_rows: list[dict[str, Any]] = []
    asset_rows: dict[str, dict[str, Any]] = {}
    for case in root_manifest["cases"]:
        harp, query, records = query_case_records(case)
        vector_records: list[dict[str, Any]] = []
        for record in records:
            segment_asset_ids: dict[str, str] = {}
            for name, source_path in record["segmentPaths"].items():
                source_url = JSOC_FILE_ORIGIN + source_path
                asset_id = "sharp-asset-" + digest(source_url)[:16]
                segment_asset_ids[name] = asset_id
                if asset_id not in asset_rows:
                    safe_time = re.sub(r"[^0-9A-Za-z-]+", "-", record["observedAt"])
                    cached_asset = cached_assets.get(asset_id, {})
                    asset_rows[asset_id] = {
                        "assetId": asset_id,
                        "caseIds": [case["caseId"]],
                        "recordIds": [record["recordId"]],
                        "segment": name,
                        "observedAt": record["observedAt"],
                        "sourcePath": source_path,
                        "sourceUrl": source_url,
                        "relativePath": (
                            f"{SUPPLEMENT_DIR}/raw/{case['caseId']}/{safe_time}/{name}.fits"
                        ),
                        "bytes": int(cached_asset.get("bytes") or 0),
                        "sha256": cached_asset.get("sha256"),
                        "downloadStatus": cached_asset.get("downloadStatus", "planned"),
                    }
                else:
                    row = asset_rows[asset_id]
                    row["caseIds"] = sorted(set([*row["caseIds"], case["caseId"]]))
                    row["recordIds"] = sorted(
                        set([*row["recordIds"], record["recordId"]])
                    )
            vector_records.append(
                {
                    "recordId": record["recordId"],
                    "observedAt": record["observedAt"],
                    "quality": record["quality"],
                    "keywords": record["keywords"],
                    "segmentAssetIds": segment_asset_ids,
                }
            )
        case_rows.append(
            {
                "caseId": case["caseId"],
                "activeRegion": case["activeRegion"],
                "harpNum": harp,
                "query": query,
                "recordCount": len(vector_records),
                "records": vector_records,
            }
        )

    assets = list(asset_rows.values())
    assets_requiring_preflight = [row for row in assets if int(row["bytes"]) <= 0]
    reused_asset_count = len(assets) - len(assets_requiring_preflight)
    if reused_asset_count:
        print(
            f"reused cached size/checksum metadata for {reused_asset_count}/{len(assets)} assets",
            flush=True,
        )
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(content_length, row["sourceUrl"]): row
            for row in assets_requiring_preflight
        }
        for index, future in enumerate(as_completed(futures), start=1):
            futures[future]["bytes"] = future.result()
            if index % 100 == 0 or index == len(futures):
                print(f"preflight {index}/{len(futures)} new assets", flush=True)
    assets.sort(key=lambda row: (row["observedAt"], row["segment"], row["assetId"]))
    total_bytes = sum(int(row["bytes"]) for row in assets)
    primary_bytes = int(root_manifest["plannedTotalBytes"])
    budget = int(root_manifest.get("budgetBytes") or 70_000_000_000)
    if primary_bytes + total_bytes > budget:
        raise RuntimeError(
            f"primary + SHARP supplement exceeds pack budget: {primary_bytes + total_bytes} > {budget}"
        )
    return {
        "format": FORMAT,
        "schemaVersion": 1,
        "datasetId": f"{root_manifest['datasetId']}-hmi-sharp-vector-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSeries": "hmi.sharp_cea_720s",
        "segments": list(SEGMENTS),
        "primaryManifestSha256AtPlan": sha256(root / "manifest.json"),
        "scientificBoundary": (
            "Br/Bt/Bp、分量误差和消歧置信度用于活动区矢量磁场代理；"
            "它们不等于日冕自由能、重联率或加热机制标签。"
        ),
        "caseCount": len(case_rows),
        "recordCount": sum(row["recordCount"] for row in case_rows),
        "assetCount": len(assets),
        "plannedTotalBytes": total_bytes,
        "complete": False,
        "cases": case_rows,
        "assets": assets,
    }


def valid_existing(root: Path, asset: dict[str, Any]) -> bool:
    path = root / asset["relativePath"]
    if not path.is_file() or path.stat().st_size != int(asset["bytes"]):
        return False
    actual = sha256(path)
    expected = asset.get("sha256")
    if expected and actual.lower() != str(expected).lower():
        return False
    asset["sha256"] = actual
    asset["downloadStatus"] = "verified"
    return True


def download_asset(root: Path, asset: dict[str, Any]) -> None:
    if valid_existing(root, asset):
        return
    destination = root / asset["relativePath"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(f".{destination.name}.part")
    run_curl(
        ["--max-time", "900", "-fsSL", "-o", str(partial), asset["sourceUrl"]],
        timeout=930,
    )
    if partial.stat().st_size != int(asset["bytes"]):
        raise RuntimeError(
            f"incomplete download {asset['assetId']}: "
            f"{partial.stat().st_size} != {asset['bytes']}"
        )
    partial.replace(destination)
    asset["sha256"] = sha256(destination)
    asset["downloadStatus"] = "verified"


def register_supplement(
    root: Path, root_manifest: dict[str, Any], manifest_path: Path, manifest: dict[str, Any]
) -> None:
    manifest_sha = sha256(manifest_path)
    reference = {
        "kind": "hmi-sharp-vector",
        "format": FORMAT,
        "relativePath": manifest_path.relative_to(root).as_posix(),
        "sha256": manifest_sha,
        "assetCount": int(manifest["assetCount"]),
        "requestedAssetCount": int(manifest["assetCount"]),
        "bytes": int(manifest["plannedTotalBytes"]),
        "complete": bool(manifest["complete"]),
        "generatedAt": str(manifest["generatedAt"]),
    }
    references = [
        item
        for item in root_manifest.get("dataSupplements", [])
        if item.get("kind") != reference["kind"]
    ]
    references.append(reference)
    root_manifest["dataSupplements"] = references
    root_manifest["supplementalBytes"] = sum(
        int(item.get("bytes", 0)) for item in references
    )
    root_manifest["totalBytesIncludingSupplements"] = int(
        root_manifest["plannedTotalBytes"]
    ) + int(root_manifest["supplementalBytes"])
    atomic_json(root / "manifest.json", root_manifest)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--download-workers", type=int, default=4)
    args = parser.parse_args()
    if not args.plan and not args.download:
        parser.error("choose --plan or --download")

    root = Path(args.dataset_root).resolve()
    root_manifest_path = Path(args.manifest).resolve()
    root_manifest = json.loads(root_manifest_path.read_text(encoding="utf-8"))
    supplement_root = root / SUPPLEMENT_DIR
    manifest_path = supplement_root / "manifest.json"
    plan_path = supplement_root / "manifest.plan.json"

    # Prefer an unfinished plan over the older completed catalog after the root
    # case set has been extended. The completed catalog remains the reuse source
    # while planning, but must not shadow the newly written plan on --download.
    cached_path = plan_path if plan_path.is_file() else manifest_path
    manifest: dict[str, Any] | None = None
    cached_assets: dict[str, dict[str, Any]] = {}
    if cached_path.is_file():
        cached = json.loads(cached_path.read_text(encoding="utf-8"))
        if cached.get("format") != FORMAT:
            raise RuntimeError(f"unexpected supplement format in {cached_path}")
        cached_assets = {
            str(asset["assetId"]): asset
            for asset in cached.get("assets", [])
            if asset.get("assetId")
        }
        root_case_ids = {str(case["caseId"]) for case in root_manifest["cases"]}
        cached_case_ids = {str(case["caseId"]) for case in cached.get("cases", [])}
        if root_case_ids == cached_case_ids:
            manifest = cached
            print(f"using cached SHARP catalog: {cached_path}", flush=True)
        else:
            print(
                "root case set changed; rebuilding the SHARP catalog before reuse",
                flush=True,
            )
    if manifest is None:
        manifest = build_plan(root_manifest, root, args.workers, cached_assets)
        atomic_json(plan_path, manifest)

    print(
        f"SHARP plan: {manifest['recordCount']} records, {manifest['assetCount']} files, "
        f"{manifest['plannedTotalBytes'] / 1_000_000_000:.3f} GB",
        flush=True,
    )
    if args.plan and not args.download:
        return

    pending = [row for row in manifest["assets"] if not valid_existing(root, row)]
    with ThreadPoolExecutor(max_workers=max(1, args.download_workers)) as executor:
        futures = {executor.submit(download_asset, root, row): row for row in pending}
        for index, future in enumerate(as_completed(futures), start=1):
            future.result()
            if index % 50 == 0 or index == len(futures):
                print(f"download {index}/{len(futures)}", flush=True)
                atomic_json(manifest_path, manifest)

    verified = sum(valid_existing(root, row) for row in manifest["assets"])
    manifest["complete"] = verified == int(manifest["assetCount"])
    manifest["verifiedAssetCount"] = verified
    atomic_json(manifest_path, manifest)
    register_supplement(root, root_manifest, manifest_path, manifest)
    if plan_path.is_file():
        plan_path.unlink()
    print(
        f"SHARP complete: {verified}/{manifest['assetCount']} files verified; "
        f"root total {root_manifest.get('totalBytesIncludingSupplements', 0) / 1_000_000_000:.3f} GB",
        flush=True,
    )


if __name__ == "__main__":
    main()
