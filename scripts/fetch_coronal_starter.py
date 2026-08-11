#!/usr/bin/env python3
"""Build the small, provenance-first SDO coronal-observation starter pack.

This script deliberately downloads a bounded collection of public JSOC assets.
It is not a bulk archive client and it never assigns a heating-mechanism label
to a window.  Every downloaded FITS file is tied to its original JSOC query,
source URL, quality flag, byte length and SHA-256 in ``manifest.json``.

Usage:
    python scripts/fetch_coronal_starter.py --plan
    python scripts/fetch_coronal_starter.py --download

The default cap is 9.3 decimal GB, leaving a visible margin below the requested
10 GB workspace limit.  ``--download`` refuses to start when the preflight
size check exceeds the cap.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


DATASET_ID = "coronal-starter-v1"
FORMAT = "open-scientist-coronal-observation-pack-v1"
JSOC_INFO_URL = "http://jsoc.stanford.edu/cgi-bin/ajax/jsoc_info"
JSOC_FILE_ORIGIN = "https://jsoc1.stanford.edu"
DEFAULT_BUDGET_BYTES = 9_300_000_000
CHUNK_BYTES = 1024 * 1024
USER_AGENT = "open-scientist-coronal-starter/1.0 (public research data pack)"

# These are deliberately *window* identifiers, not mechanism labels.  The
# phenomenon remains an input to the scientific loop; the data pack itself
# cannot decide whether waves, reconnection, or a coupled process dominates.
CASE_SPECS: tuple[dict[str, Any], ...] = (
    {
        "caseId": "ar11158-background-20110214",
        "label": "NOAA 11158 多波段背景窗口",
        "activeRegion": "NOAA 11158",
        "startTai": "2011.02.14_16:00_TAI",
        "duration": "2h",
        "purpose": "用于比较同一活动区不同时间段的多波段与磁场背景；未赋予机制标签。",
        "includeBurst": False,
    },
    {
        "caseId": "ar11158-window-20110215",
        "label": "NOAA 11158 多波段短时窗口",
        "activeRegion": "NOAA 11158",
        "startTai": "2011.02.15_01:30_TAI",
        "duration": "2h",
        "purpose": "用于检查短时 EUV 演化、温度响应和磁场背景；未赋予机制标签。",
        "includeBurst": True,
    },
    {
        "caseId": "ar11429-window-20120307",
        "label": "NOAA 11429 多波段短时窗口",
        "activeRegion": "NOAA 11429",
        "startTai": "2012.03.07_00:00_TAI",
        "duration": "2h",
        "purpose": "用于跨活动区比较多波段与磁场背景；未赋予机制标签。",
        "includeBurst": False,
    },
)

CORE_AIA_BANDS = ("94", "131", "171", "193", "211", "335")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_filename(value: str) -> str:
    return "".join(char if char.isalnum() else "-" for char in value).strip("-")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def run_curl(arguments: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
    executable = shutil.which("curl.exe") or shutil.which("curl")
    if not executable:
        raise RuntimeError("curl is required to download the JSOC starter pack")
    return subprocess.run(
        [
            executable,
            "--noproxy",
            "*",
            "--connect-timeout",
            "20",
            "--retry",
            "3",
            "--retry-delay",
            "2",
            *arguments,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def request_json(url: str, parameters: dict[str, str]) -> dict[str, Any]:
    response = run_curl(
        ["--max-time", "90", "-fsS", f"{url}?{urlencode(parameters)}"],
        timeout=100,
    )
    return json.loads(response.stdout)


def jsoc_records(dataset: str, segment: str) -> list[dict[str, str]]:
    payload = request_json(
        JSOC_INFO_URL,
        {"op": "rs_list", "ds": dataset, "key": "T_REC,QUALITY", "seg": segment},
    )
    if payload.get("status") != 0:
        raise RuntimeError(f"JSOC query failed ({payload.get('status')}): {dataset}")
    keywords = {item.get("name"): item.get("values", []) for item in payload.get("keywords", [])}
    segments = {item.get("name"): item.get("values", []) for item in payload.get("segments", [])}
    times = keywords.get("T_REC", [])
    qualities = keywords.get("QUALITY", [])
    paths = segments.get(segment, [])
    if not (len(times) == len(qualities) == len(paths) == int(payload.get("count", -1))):
        raise RuntimeError(f"JSOC response is structurally incomplete for: {dataset}")
    records: list[dict[str, str]] = []
    for observed_at, quality, source_path in zip(times, qualities, paths, strict=True):
        if quality != "0x00000000":
            continue
        records.append({
            "observedAt": str(observed_at),
            "quality": str(quality),
            "sourcePath": str(source_path),
            "sourceUrl": JSOC_FILE_ORIGIN + str(source_path),
            "query": dataset,
        })
    if not records:
        raise RuntimeError(f"JSOC returned no QUALITY=0 records for: {dataset}")
    return records


def add_records(
    logical: list[dict[str, Any]],
    case: dict[str, Any],
    *,
    stream_id: str,
    instrument: str,
    segment: str,
    cadence_seconds: int,
    dataset: str,
    wavelength: str | None = None,
) -> None:
    for record in jsoc_records(dataset, segment):
        logical.append({
            "logicalId": "obs-" + digest(
                "|".join([case["caseId"], stream_id, record["sourceUrl"]])
            )[:16],
            "caseId": case["caseId"],
            "streamId": stream_id,
            "instrument": instrument,
            "kind": "image",
            "segment": segment,
            "cadenceSeconds": cadence_seconds,
            "wavelengthOrBand": wavelength,
            **record,
        })


def collect_logical_observations() -> list[dict[str, Any]]:
    logical: list[dict[str, Any]] = []
    for case in CASE_SPECS:
        for band in CORE_AIA_BANDS:
            add_records(
                logical,
                case,
                stream_id="aia-core-4min",
                instrument="SDO/AIA",
                segment="image",
                cadence_seconds=240,
                wavelength=band + " Å",
                dataset=(
                    f"aia.lev1_euv_12s[{case['startTai']}/{case['duration']}@4m][{band}]"
                ),
            )
        add_records(
            logical,
            case,
            stream_id="hmi-los-12min",
            instrument="SDO/HMI",
            segment="magnetogram",
            cadence_seconds=720,
            dataset=f"hmi.M_45s[{case['startTai']}/{case['duration']}@12m]",
            wavelength="line-of-sight magnetogram",
        )
        if case["includeBurst"]:
            for band in ("171", "193"):
                add_records(
                    logical,
                    case,
                    stream_id="aia-burst-24s",
                    instrument="SDO/AIA",
                    segment="image",
                    cadence_seconds=24,
                    wavelength=band + " Å",
                    dataset=f"aia.lev1_euv_12s[2011.02.15_01:42_TAI/30m@24s][{band}]",
                )
    return logical


def content_length(url: str) -> int:
    response = run_curl(["--max-time", "90", "-fsSI", url], timeout=100)
    values = [
        line.split(":", 1)[1].strip()
        for line in response.stdout.splitlines()
        if line.lower().startswith("content-length:")
    ]
    value = values[-1] if values else ""
    try:
        length = int(value or "")
    except ValueError as error:
        raise RuntimeError(f"Could not determine Content-Length: {url}") from error
    if length <= 0:
        raise RuntimeError(f"Invalid Content-Length ({length}): {url}")
    return length


def preflight_assets(logical: list[dict[str, Any]], workers: int) -> list[dict[str, Any]]:
    by_url: dict[str, list[dict[str, Any]]] = {}
    for item in logical:
        by_url.setdefault(item["sourceUrl"], []).append(item)

    sizes: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(content_length, url): url for url in by_url}
        for index, future in enumerate(as_completed(futures), start=1):
            url = futures[future]
            sizes[url] = future.result()
            if index % 25 == 0 or index == len(futures):
                print(f"preflight {index}/{len(futures)}", flush=True)

    assets: list[dict[str, Any]] = []
    for url, references in sorted(by_url.items()):
        first = references[0]
        timestamp = safe_filename(first["observedAt"])
        band = safe_filename(first["wavelengthOrBand"] or "magnetogram")
        relative_path = Path(
            "raw",
            first["instrument"].split("/")[-1].lower(),
            first["caseId"],
            band,
            timestamp + ".fits",
        )
        assets.append({
            "assetId": "asset-" + digest(url)[:16],
            "kind": "image",
            "instrument": first["instrument"],
            "segment": first["segment"],
            "wavelengthOrBand": first["wavelengthOrBand"],
            "observedAt": first["observedAt"],
            "sourceUrl": url,
            "sourcePath": first["sourcePath"],
            "queries": sorted({reference["query"] for reference in references}),
            "quality": first["quality"],
            "caseIds": sorted({reference["caseId"] for reference in references}),
            "logicalIds": sorted(reference["logicalId"] for reference in references),
            "relativePath": relative_path.as_posix(),
            "bytes": sizes[url],
            "sha256": None,
            "downloadStatus": "planned",
        })
    return assets


def build_manifest(
    logical: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    budget_bytes: int,
) -> dict[str, Any]:
    asset_by_url = {asset["sourceUrl"]: asset for asset in assets}
    case_entries = []
    for case in CASE_SPECS:
        observations = []
        for item in logical:
            if item["caseId"] != case["caseId"]:
                continue
            asset = asset_by_url[item["sourceUrl"]]
            observations.append({
                "logicalId": item["logicalId"],
                "assetId": asset["assetId"],
                "streamId": item["streamId"],
                "instrument": item["instrument"],
                "kind": item["kind"],
                "wavelengthOrBand": item["wavelengthOrBand"],
                "cadenceSeconds": item["cadenceSeconds"],
                "observedAt": item["observedAt"],
                "quality": item["quality"],
            })
        case_entries.append({
            **case,
            "observations": observations,
        })
    total_bytes = sum(int(asset["bytes"]) for asset in assets)
    return {
        "format": FORMAT,
        "datasetId": DATASET_ID,
        "generatedAt": utc_now(),
        "sourceCatalog": {
            "name": "JSOC SDO data archive",
            "catalogEndpoint": JSOC_INFO_URL,
            "fileOrigin": JSOC_FILE_ORIGIN,
            "licenseOrTerms": "See JSOC/SDO data-use terms; preserve source queries in this manifest.",
        },
        "budgetBytes": budget_bytes,
        "plannedTotalBytes": total_bytes,
        "uniqueAssetCount": len(assets),
        "logicalObservationCount": len(logical),
        "caseCount": len(CASE_SPECS),
        "scientificBoundary": {
            "mechanismLabels": "none",
            "statement": (
                "This starter pack supports bounded data availability and time-series checks. "
                "It does not by itself establish a coronal-heating mechanism, wave damping, "
                "or nanoflare occurrence."
            ),
            "knownGaps": [
                "No spectroscopy or Doppler/non-thermal line-width diagnostic is included.",
                "The 24-second burst exists for one AIA two-band window only.",
                "Direct JSOC segment files are preserved as raw assets; spatial alignment must use "
                "a later WCS-aware processing run and may require richer export headers.",
            ],
        },
        "cases": case_entries,
        "assets": assets,
    }


def hash_existing(path: Path, expected: int) -> str | None:
    if not path.is_file() or path.stat().st_size != expected:
        return None
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_BYTES), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def download_asset(root: Path, asset: dict[str, Any]) -> None:
    destination = root / asset["relativePath"]
    existing_hash = hash_existing(destination, int(asset["bytes"]))
    if existing_hash:
        asset["sha256"] = existing_hash
        asset["downloadStatus"] = "verified"
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    if partial.exists():
        partial.unlink()

    run_curl(
        ["--max-time", "900", "-fsSL", "-o", str(partial), asset["sourceUrl"]],
        timeout=930,
    )
    received = partial.stat().st_size if partial.exists() else 0
    if received != int(asset["bytes"]):
        partial.unlink(missing_ok=True)
        raise RuntimeError(
            f"Incomplete download for {asset['assetId']}: received {received}, expected {asset['bytes']}"
        )
    partial.replace(destination)
    asset["sha256"] = hash_existing(destination, received)
    asset["downloadStatus"] = "verified"


def pack_summary(manifest: dict[str, Any]) -> str:
    verified = sum(asset["downloadStatus"] == "verified" for asset in manifest["assets"])
    total = len(manifest["assets"])
    total_gb = manifest["plannedTotalBytes"] / 1_000_000_000
    return (
        f"{manifest['datasetId']}: {verified}/{total} files verified; "
        f"planned size {total_gb:.3f} GB; {manifest['logicalObservationCount']} logical observations"
    )


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true", help="query and preflight without downloading")
    parser.add_argument("--download", action="store_true", help="download and hash every preflighted asset")
    parser.add_argument(
        "--output",
        type=Path,
        default=repository_root / "data" / "dataset" / DATASET_ID,
        help="destination directory for the local data pack",
    )
    parser.add_argument(
        "--budget-bytes",
        type=int,
        default=DEFAULT_BUDGET_BYTES,
        help="hard byte cap; download will not start if the preflight exceeds it",
    )
    parser.add_argument("--workers", type=int, default=6, help="parallel JSOC metadata HEAD requests")
    parser.add_argument("--download-workers", type=int, default=4, help="parallel FITS downloads")
    args = parser.parse_args()
    if args.plan == args.download:
        parser.error("choose exactly one of --plan or --download")
    if args.budget_bytes <= 0 or args.workers <= 0 or args.download_workers <= 0:
        parser.error("budget-bytes, workers and download-workers must be positive")
    return args


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    manifest_path = output / "manifest.json"
    print("querying JSOC catalog", flush=True)
    logical = collect_logical_observations()
    print(f"catalog contains {len(logical)} logical observations", flush=True)
    assets = preflight_assets(logical, args.workers)
    manifest = build_manifest(logical, assets, args.budget_bytes)
    json_dump(manifest_path, manifest)
    print(pack_summary(manifest), flush=True)

    if manifest["plannedTotalBytes"] > args.budget_bytes:
        print(
            f"refusing download: preflight {manifest['plannedTotalBytes']} exceeds budget {args.budget_bytes}",
            file=sys.stderr,
            flush=True,
        )
        return 2
    if args.plan:
        return 0

    with ThreadPoolExecutor(max_workers=args.download_workers) as executor:
        futures = [executor.submit(download_asset, output, asset) for asset in manifest["assets"]]
        for index, future in enumerate(as_completed(futures), start=1):
            future.result()
            if index % 5 == 0 or index == len(manifest["assets"]):
                json_dump(manifest_path, manifest)
                print(f"download {index}/{len(manifest['assets'])}: {pack_summary(manifest)}", flush=True)
    json_dump(manifest_path, manifest)
    print("download complete: " + pack_summary(manifest), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("cancelled; verified files remain resumable", file=sys.stderr)
        raise SystemExit(130)
