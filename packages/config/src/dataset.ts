export type JwfdScalar = string | number

export interface JwfdSnapshot {
  snapshot_id: string
  [column: string]: JwfdScalar
}

export interface JwfdTarget {
  snapshot_id: string
  target: number
}

export interface JwfdDatasetManifest {
  format: 'open-scientist-jwfd-csv-v1'
  datasetId?: string
  targetColumn: string
  sampleIdColumn: 'image_filename'
  featureColumns: string[]
  rowCount: number
  positiveCount: number
  negativeCount: number
}

export interface JwfdSnapshotArtifacts {
  snapshots: JwfdSnapshot[]
  targets: JwfdTarget[]
  manifest: JwfdDatasetManifest
}

export function renderJwfdEvalScript(): string {
  return `#!/usr/bin/env python3
"""Evaluate a filter against a deterministic JW-FD snapshot/target pair."""

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

DATASET_DIR = Path(__file__).parent
SNAPSHOTS_PATH = DATASET_DIR / "snapshots.jsonl"
TARGETS_PATH = DATASET_DIR / "targets.jsonl"
MANIFEST_PATH = DATASET_DIR / "dataset_manifest.json"


def load_filter(filter_path):
    spec = importlib.util.spec_from_file_location("hypothesis_filter", filter_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load filter module: {filter_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "filter"):
        raise RuntimeError(f"No 'filter' function found in {filter_path}")
    return module.filter


def load_jsonl(path):
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def alignment_fields_available():
    """Expose only metadata explicitly declared as a dataset feature column."""
    try:
        with MANIFEST_PATH.open(encoding="utf-8") as handle:
            feature_columns = set(json.load(handle).get("featureColumns", []))
    except (FileNotFoundError, json.JSONDecodeError, TypeError):
        return False
    return {"active_region", "timestamp", "wavelength"}.issubset(feature_columns)


def candidate_snapshot(snapshot, fields_available):
    if not fields_available:
        return None
    return {
        "snapshotId": str(snapshot["snapshot_id"]),
        "activeRegion": str(snapshot["active_region"]),
        "timestamp": str(snapshot["timestamp"]),
        "wavelength": str(snapshot["wavelength"]),
    }


def evaluate(filter_fn):
    snapshots = load_jsonl(SNAPSHOTS_PATH)
    targets = {row["snapshot_id"]: row["target"] for row in load_jsonl(TARGETS_PATH)}
    tp, fp, fn = 0, 0, 0
    counterexamples = []
    candidate_snapshots = []
    fields_available = alignment_fields_available()

    for snapshot in snapshots:
        snapshot_id = snapshot.get("snapshot_id")
        if snapshot_id not in targets:
            raise RuntimeError(f"missing target for snapshot {snapshot_id}")
        try:
            predicted = bool(filter_fn(snapshot))
        except Exception as exc:
            raise RuntimeError(
                f"filter failed for snapshot {snapshot_id}: {type(exc).__name__}: {exc}"
            ) from exc

        if predicted and len(candidate_snapshots) < 10:
            candidate = candidate_snapshot(snapshot, fields_available)
            if candidate is not None:
                candidate_snapshots.append(candidate)

        expected_positive = float(targets[snapshot_id]) > 0
        if predicted and expected_positive:
            tp += 1
        elif predicted and not expected_positive:
            fp += 1
            if len(counterexamples) < 10:
                counterexamples.append({
                    "snapshotId": snapshot_id,
                    "reason": "FP: filter predicted positive but the selected JW-FD target is negative",
                    "expected": "negative",
                    "actual": "positive",
                })
        elif not predicted and expected_positive:
            fn += 1
            if len(counterexamples) < 10:
                counterexamples.append({
                    "snapshotId": snapshot_id,
                    "reason": "FN: filter predicted negative but the selected JW-FD target is positive",
                    "expected": "positive",
                    "actual": "negative",
                })

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "f1": round(f1, 4),
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "counterexamples": counterexamples,
        "candidateSnapshots": candidate_snapshots,
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python eval.py <filter_file>")
    started = time.time()
    result = evaluate(load_filter(sys.argv[1]))
    result["hypoId"] = os.environ.get("HYPO_ID", "unknown")
    result["logs"] = "evaluated snapshots.jsonl with targets.jsonl"
    result["executionMs"] = int((time.time() - started) * 1000)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
`
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }

    if (char === '"' && cell.length === 0) {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (quoted) throw new Error('invalid CSV: unterminated quoted field')
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell)
    if (row.some((value) => value.length > 0)) rows.push(row)
  }
  return rows
}

function parseScalar(raw: string): JwfdScalar {
  const value = raw.trim()
  if (value === '') return ''
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

function isGroundTruthColumn(column: string): boolean {
  return column.startsWith('flare_label_') || column.startsWith('flare_class_')
}

export function buildJwfdSnapshotArtifacts(
  csvText: string,
  targetColumn: string,
): JwfdSnapshotArtifacts {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) throw new Error('JW-FD CSV must contain a header and at least one row')

  const headers = rows[0]!.map((header) => header.trim())
  if (headers.some((header) => header.length === 0)) throw new Error('JW-FD CSV contains an empty column name')
  if (new Set(headers).size !== headers.length) throw new Error('JW-FD CSV contains duplicate column names')

  const idIndex = headers.indexOf('image_filename')
  const targetIndex = headers.indexOf(targetColumn)
  if (idIndex < 0) throw new Error('JW-FD CSV missing sample identifier column image_filename')
  if (targetIndex < 0) throw new Error(`JW-FD CSV missing target column: ${targetColumn}`)

  const featureColumns = headers.filter((column) => !isGroundTruthColumn(column))
  const snapshots: JwfdSnapshot[] = []
  const targets: JwfdTarget[] = []
  const seenIds = new Set<string>()

  for (const [rowNumber, values] of rows.slice(1).entries()) {
    if (values.length !== headers.length) {
      throw new Error(
        `JW-FD CSV row ${rowNumber + 2} has ${values.length} fields; expected ${headers.length}`,
      )
    }

    const snapshotId = values[idIndex]!.trim()
    if (!snapshotId) throw new Error(`JW-FD CSV row ${rowNumber + 2} has an empty sample identifier`)
    if (seenIds.has(snapshotId)) throw new Error(`duplicate sample identifier: ${snapshotId}`)
    seenIds.add(snapshotId)

    const target = Number(values[targetIndex]!.trim())
    if (!Number.isFinite(target)) {
      throw new Error(`JW-FD CSV row ${rowNumber + 2} has a non-numeric target: ${targetColumn}`)
    }

    const snapshot: JwfdSnapshot = { snapshot_id: snapshotId }
    for (const column of featureColumns) {
      snapshot[column] = parseScalar(values[headers.indexOf(column)]!)
    }
    snapshots.push(snapshot)
    targets.push({ snapshot_id: snapshotId, target })
  }

  const positiveCount = targets.filter(({ target }) => target > 0).length
  return {
    snapshots,
    targets,
    manifest: {
      format: 'open-scientist-jwfd-csv-v1',
      targetColumn,
      sampleIdColumn: 'image_filename',
      featureColumns,
      rowCount: snapshots.length,
      positiveCount,
      negativeCount: snapshots.length - positiveCount,
    },
  }
}
