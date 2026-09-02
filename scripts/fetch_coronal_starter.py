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
import os
import shutil
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse


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


def aia_series_for_band(band: str) -> str:
    """Return the JSOC Level-1 series that actually contains an AIA band."""
    return "aia.lev1_uv_24s" if band in {"1600", "1700"} else "aia.lev1_euv_12s"


def load_collection_spec(path: Path | None) -> tuple[str, tuple[dict[str, Any], ...], int]:
    if path is None:
        return DATASET_ID, CASE_SPECS, DEFAULT_BUDGET_BYTES
    payload = json.loads(path.read_text(encoding="utf-8"))
    dataset_id = str(payload.get("datasetId") or "").strip()
    cases = payload.get("cases")
    budget_bytes = int(payload.get("budgetBytes") or DEFAULT_BUDGET_BYTES)
    if not dataset_id or not isinstance(cases, list) or not cases:
        raise ValueError("collection spec requires a non-empty datasetId and cases array")
    case_ids = [str(case.get("caseId") or "") for case in cases]
    if any(not case_id for case_id in case_ids) or len(case_ids) != len(set(case_ids)):
        raise ValueError("collection spec caseId values must be non-empty and unique")
    required = ("label", "activeRegion", "startTai", "duration", "purpose")
    for case in cases:
        missing = [key for key in required if not case.get(key)]
        if missing:
            raise ValueError(f"{case.get('caseId', '<unknown>')} misses: {', '.join(missing)}")
    return dataset_id, tuple(cases), budget_bytes


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
    base_arguments = [
        executable,
        "--connect-timeout",
        "20",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--retry-all-errors",
    ]
    resolve_arguments: list[str] = []
    url = next((value for value in arguments if value.startswith(("http://", "https://"))), None)
    if url:
        parsed = urlparse(url)
        if parsed.hostname:
            try:
                address = socket.gethostbyname(parsed.hostname)
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                resolve_arguments = ["--resolve", f"{parsed.hostname}:{port}:{address}"]
            except OSError:
                pass
    direct_arguments = ["--noproxy", "*", *resolve_arguments]
    bypass_proxy = os.environ.get("OPEN_SCIENTIST_BYPASS_PROXY") == "1"
    attempts = [direct_arguments] if bypass_proxy else [[], direct_arguments]
    last_error: subprocess.CalledProcessError | None = None
    for network_arguments in attempts:
        try:
            return subprocess.run(
                [*base_arguments, *network_arguments, *arguments],
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.CalledProcessError as error:
            last_error = error
    assert last_error is not None
    raise last_error


def request_json(url: str, parameters: dict[str, str]) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            response = run_curl(
                ["--max-time", "90", "-fsS", f"{url}?{urlencode(parameters)}"],
                timeout=100,
            )
            return json.loads(response.stdout)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 4:
                raise
            time.sleep(min(2 ** attempt, 8))
    assert last_error is not None
    raise last_error


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


def collect_logical_observations(case_specs: tuple[dict[str, Any], ...]) -> list[dict[str, Any]]:
    logical: list[dict[str, Any]] = []
    for case in case_specs:
        core_bands = tuple(str(band) for band in case.get("coreBands", CORE_AIA_BANDS))
        core_cadence = int(case.get("coreCadenceSeconds", 240))
        for band in core_bands:
            aia_series = aia_series_for_band(band)
            add_records(
                logical,
                case,
                stream_id=f"aia-core-{core_cadence}s",
                instrument="SDO/AIA",
                segment="image",
                cadence_seconds=core_cadence,
                wavelength=band + " Å",
                dataset=(
                    f"{aia_series}[{case['startTai']}/{case['duration']}@{core_cadence}s][{band}]"
                ),
            )
        if case.get("includeHmi", True):
            hmi_cadence = int(case.get("hmiCadenceSeconds", 720))
            hmi_series = str(case.get("hmiSeries", "hmi.M_720s"))
            add_records(
                logical,
                case,
                stream_id=f"hmi-los-{hmi_cadence}s",
                instrument="SDO/HMI",
                segment="magnetogram",
                cadence_seconds=hmi_cadence,
                dataset=f"{hmi_series}[{case['startTai']}/{case['duration']}@{hmi_cadence}s]",
                wavelength="line-of-sight magnetogram",
            )
        burst = case.get("burst")
        if burst is None and case.get("includeBurst"):
            burst = {
                "startTai": "2011.02.15_01:42_TAI",
                "duration": "30m",
                "cadenceSeconds": 24,
                "bands": ["171", "193"],
            }
        if burst:
            burst_cadence = int(burst.get("cadenceSeconds", 24))
            for band in tuple(str(value) for value in burst.get("bands", ("171", "193"))):
                aia_series = aia_series_for_band(band)
                add_records(
                    logical,
                    case,
                    stream_id=f"aia-burst-{burst_cadence}s",
                    instrument="SDO/AIA",
                    segment="image",
                    cadence_seconds=burst_cadence,
                    wavelength=band + " Å",
                    dataset=(
                        f"{aia_series}[{burst.get('startTai', case['startTai'])}/"
                        f"{burst.get('duration', '30m')}@{burst_cadence}s][{band}]"
                    ),
                )
    return logical


def content_length(url: str) -> int:
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            response = run_curl(["--max-time", "90", "-fsSI", url], timeout=100)
            break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            last_error = error
            if attempt == 4:
                raise
            time.sleep(min(2 ** attempt, 8))
    else:  # pragma: no cover - the loop either breaks or raises
        assert last_error is not None
        raise last_error
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


def preflight_assets(
    logical: list[dict[str, Any]], workers: int, cache_path: Path | None = None
) -> list[dict[str, Any]]:
    by_url: dict[str, list[dict[str, Any]]] = {}
    for item in logical:
        by_url.setdefault(item["sourceUrl"], []).append(item)

    sizes: dict[str, int] = {}
    if cache_path and cache_path.is_file():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            sizes = {
                str(url): int(size)
                for url, size in cached.get("sizes", {}).items()
                if url in by_url and int(size) > 0
            }
            if sizes:
                print(f"preflight cache hit {len(sizes)}/{len(by_url)}", flush=True)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            sizes = {}
    pending_urls = [url for url in by_url if url not in sizes]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(content_length, url): url for url in pending_urls}
        for index, future in enumerate(as_completed(futures), start=1):
            url = futures[future]
            sizes[url] = future.result()
            completed = len(sizes)
            if cache_path and (index % 25 == 0 or index == len(futures)):
                json_dump(cache_path, {"format": "jsoc-content-length-cache-v1", "sizes": sizes})
            if index % 25 == 0 or index == len(futures):
                print(f"preflight {completed}/{len(by_url)}", flush=True)

    assets: list[dict[str, Any]] = []
    for url, references in sorted(by_url.items()):
        first = references[0]
        timestamp = safe_filename(first["observedAt"])
        band = safe_filename(first["wavelengthOrBand"] or "magnetogram")
        if first["instrument"] == "SDO/HMI":
            series = str(first["query"]).split("[", 1)[0]
            band = f"{band}-{safe_filename(series)}"
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
    dataset_id: str,
    case_specs: tuple[dict[str, Any], ...],
    spec_path: Path | None,
) -> dict[str, Any]:
    asset_by_url = {asset["sourceUrl"]: asset for asset in assets}
    case_entries = []
    for case in case_specs:
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
        "datasetId": dataset_id,
        "generatedAt": utc_now(),
        "collectionSpec": (
            {
                "path": str(spec_path.resolve()),
                "sha256": hashlib.sha256(spec_path.read_bytes()).hexdigest(),
            }
            if spec_path
            else None
        ),
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
        "caseCount": len(case_specs),
        "scientificBoundary": {
            "mechanismLabels": "none",
            "statement": (
                "This starter pack supports bounded data availability and time-series checks. "
                "It does not by itself establish a coronal-heating mechanism, wave damping, "
                "or nanoflare occurrence."
            ),
            "knownGaps": [
                "No spectroscopy or Doppler/non-thermal line-width diagnostic is included.",
                "High-cadence coverage is intentionally limited to pre-registered target windows.",
                "Direct JSOC segment files are preserved as raw assets; HMI record WCS/BUNIT/time "
                "keywords are retained in a checksummed JSOC metadata sidecar before analysis.",
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


def download_asset(root: Path, asset: dict[str, Any], reuse_roots: tuple[Path, ...]) -> None:
    destination = root / asset["relativePath"]
    if (
        asset.get("downloadStatus") == "verified"
        and asset.get("sha256")
        and destination.is_file()
        and destination.stat().st_size == int(asset["bytes"])
    ):
        return
    existing_hash = hash_existing(destination, int(asset["bytes"]))
    if existing_hash:
        asset["sha256"] = existing_hash
        asset["downloadStatus"] = "verified"
        return

    if not destination.exists():
        for reuse_root in reuse_roots:
            candidate = reuse_root / asset["relativePath"]
            reused_hash = hash_existing(candidate, int(asset["bytes"]))
            if not reused_hash:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(candidate, destination)
                asset["reuseMethod"] = "hardlink"
            except OSError:
                shutil.copy2(candidate, destination)
                asset["reuseMethod"] = "copy"
            asset["sha256"] = reused_hash
            asset["downloadStatus"] = "verified"
            asset["reusedFrom"] = str(candidate.resolve())
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
        "--spec",
        type=Path,
        help="JSON collection spec; defaults to the original three-case starter pack",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="destination directory for the local data pack",
    )
    parser.add_argument(
        "--budget-bytes",
        type=int,
        default=None,
        help="hard byte cap; download will not start if the preflight exceeds it",
    )
    parser.add_argument(
        "--reuse-from",
        type=Path,
        action="append",
        default=[],
        help="reuse verified assets from another pack via hard links when possible",
    )
    parser.add_argument("--workers", type=int, default=6, help="parallel JSOC metadata HEAD requests")
    parser.add_argument("--download-workers", type=int, default=4, help="parallel FITS downloads")
    args = parser.parse_args()
    if args.plan == args.download:
        parser.error("choose exactly one of --plan or --download")
    if args.budget_bytes is not None and args.budget_bytes <= 0:
        parser.error("budget-bytes must be positive")
    if args.workers <= 0 or args.download_workers <= 0:
        parser.error("budget-bytes, workers and download-workers must be positive")
    args.repository_root = repository_root
    return args


def main() -> int:
    args = parse_args()
    dataset_id, case_specs, spec_budget = load_collection_spec(args.spec)
    budget_bytes = int(args.budget_bytes or spec_budget)
    output = (
        args.output or args.repository_root / "data" / "dataset" / dataset_id
    ).resolve()
    manifest_path = output / ("manifest.plan.json" if args.plan else "manifest.json")
    manifest: dict[str, Any] | None = None
    if args.download and args.spec and manifest_path.is_file():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            spec_sha256 = hashlib.sha256(args.spec.read_bytes()).hexdigest()
            if (
                existing.get("datasetId") == dataset_id
                and existing.get("collectionSpec", {}).get("sha256") == spec_sha256
                and isinstance(existing.get("assets"), list)
                and existing.get("assets")
            ):
                manifest = existing
                manifest["budgetBytes"] = budget_bytes
                print("using cached catalog and preflight manifest", flush=True)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            manifest = None
    if manifest is None:
        print("querying JSOC catalog", flush=True)
        logical = collect_logical_observations(case_specs)
        print(f"catalog contains {len(logical)} logical observations", flush=True)
        assets = preflight_assets(logical, args.workers, output / ".preflight-sizes.json")
        manifest = build_manifest(
            logical,
            assets,
            budget_bytes,
            dataset_id,
            case_specs,
            args.spec,
        )
        json_dump(manifest_path, manifest)
    print(pack_summary(manifest), flush=True)

    if manifest["plannedTotalBytes"] > budget_bytes:
        print(
            f"refusing download: preflight {manifest['plannedTotalBytes']} exceeds budget {budget_bytes}",
            file=sys.stderr,
            flush=True,
        )
        return 2
    if args.plan:
        return 0

    case_priority = {case["caseId"]: index for index, case in enumerate(case_specs)}
    download_order = sorted(
        manifest["assets"],
        key=lambda asset: (
            min(case_priority.get(case_id, len(case_priority)) for case_id in asset["caseIds"]),
            asset["observedAt"],
            asset["assetId"],
        ),
    )
    pending_downloads: list[dict[str, Any]] = []
    for index, asset in enumerate(download_order, start=1):
        destination = output / asset["relativePath"]
        if (
            asset.get("downloadStatus") == "verified"
            and asset.get("sha256")
            and destination.is_file()
            and destination.stat().st_size == int(asset["bytes"])
        ):
            continue
        existing_hash = hash_existing(destination, int(asset["bytes"]))
        if existing_hash:
            asset["sha256"] = existing_hash
            asset["downloadStatus"] = "verified"
        else:
            pending_downloads.append(asset)
        if index % 100 == 0 or index == len(download_order):
            json_dump(manifest_path, manifest)
            print(
                f"local verification {index}/{len(download_order)}: {pack_summary(manifest)}",
                flush=True,
            )
    print(f"remote downloads required: {len(pending_downloads)}", flush=True)
    with ThreadPoolExecutor(max_workers=args.download_workers) as executor:
        reuse_roots = tuple(path.resolve() for path in args.reuse_from)
        futures = [
            executor.submit(download_asset, output, asset, reuse_roots)
            for asset in pending_downloads
        ]
        for index, future in enumerate(as_completed(futures), start=1):
            future.result()
            if index % 5 == 0 or index == len(futures):
                json_dump(manifest_path, manifest)
                print(f"download {index}/{len(futures)}: {pack_summary(manifest)}", flush=True)
    json_dump(manifest_path, manifest)
    print("download complete: " + pack_summary(manifest), flush=True)
    metadata_script = Path(__file__).with_name("enrich_hmi_metadata.py")
    subprocess.run(
        [
            sys.executable,
            str(metadata_script),
            "--manifest",
            str(manifest_path),
            "--dataset-root",
            str(output),
            "--strict",
        ],
        check=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("cancelled; verified files remain resumable", file=sys.stderr)
        raise SystemExit(130)
