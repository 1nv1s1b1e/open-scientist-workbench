#!/usr/bin/env tsx
/**
 * Generate a shared solar physics snapshot dataset for Explore agent evaluation.
 *
 * Produces `data/dataset/snapshots.jsonl` — 50,000 physically-plausible synthetic
 * solar snapshots with ground-truth "heating event" labels.
 *
 * The dataset is deliberately synthetic (no SDO/AIA download required) but has
 * physically meaningful structure:
 * - "Heating events" (label=1) are correlated with high temperature (>1MK),
 *   strong magnetic fields (>50G), and short Alfvén wave periods.
 * - The ground truth is a combination of AC+DC heating signatures so that
 *   different hypothesis families (wave heating, nanoflare reconnection,
 *   turbulent cascade) can all find partial signal.
 *
 * Also writes `data/dataset/eval.py` — the shared evaluation script that the
 * Explore agent uses to compute F1 for any `filter(snapshot) -> bool` function.
 *
 * Usage:
 *   npx tsx scripts/generate-dataset.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATASET_DIR = resolve(process.cwd(), 'data', 'dataset')
const SNAPSHOTS_PATH = resolve(DATASET_DIR, 'snapshots.jsonl')
const EVAL_SCRIPT_PATH = resolve(DATASET_DIR, 'eval.py')
const NUM_SNAPSHOTS = 50_000

// ─── snapshot fields ──────────────────────────────────────────────────────────

interface Snapshot {
  snapshot_id: number
  active_region: number
  timestamp: string
  wavelength: number // Å
  temperature: number // K
  density: number // cm^-3
  magnetic_strength: number // G
  loop_length: number // Mm
  loop_width: number // Mm
  velocity_amplitude: number // km/s (Alfvén wave amplitude)
  wave_period: number // s (dominant Alfvén wave period)
  nonthermal_velocity: number // km/s
  emission_measure: number // cm^-5
  has_kink_oscillation: boolean
  label: number // ground truth: 1 = heating event, 0 = quiescent
}

function randn(mean: number, std: number): number {
  // Box-Muller
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * std
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

function generateSnapshot(id: number): Snapshot {
  // ~35% of snapshots are heating events
  const label = Math.random() < 0.35 ? 1 : 0

  const ar = 11000 + Math.floor(Math.random() * 1000) // AR11400-AR11999

  if (label === 1) {
    // Heating event: high T, strong B, large velocity amplitude, short wave period
    // Mix of AC and DC signatures
    const isAC = Math.random() < 0.5

    return {
      snapshot_id: id,
      active_region: ar,
      timestamp: new Date(Date.now() - Math.random() * 365 * 24 * 3600 * 1000).toISOString(),
      wavelength: [171, 193, 211, 304, 94, 131, 335][Math.floor(Math.random() * 7)],
      temperature: clamp(randn(1.5e6, 5e5), 8e5, 5e6), // 0.8-5 MK
      density: clamp(randn(3e8, 1e8), 5e7, 1e9),
      magnetic_strength: clamp(randn(80, 30), 30, 200), // strong B
      loop_length: clamp(randn(50, 30), 10, 200),
      loop_width: clamp(randn(5, 2), 1, 15),
      velocity_amplitude: clamp(randn(25, 10), 5, 60), // large Alfvén amplitude
      wave_period: isAC ? clamp(randn(150, 50), 60, 400) : clamp(randn(300, 100), 100, 600),
      nonthermal_velocity: clamp(randn(30, 10), 10, 80), // high non-thermal
      emission_measure: clamp(randn(1e27, 5e26), 1e26, 1e28),
      has_kink_oscillation: isAC ? Math.random() < 0.6 : Math.random() < 0.3,
      label: 1,
    }
  }

  // Quiescent: low T, weak B, low velocity
  return {
    snapshot_id: id,
    active_region: ar,
    timestamp: new Date(Date.now() - Math.random() * 365 * 24 * 3600 * 1000).toISOString(),
    wavelength: [171, 193, 211, 304, 94, 131, 335][Math.floor(Math.random() * 7)],
    temperature: clamp(randn(0.5e6, 2e5), 3e5, 1.2e6), // <1.2 MK
    density: clamp(randn(1e8, 5e7), 1e7, 5e8),
    magnetic_strength: clamp(randn(15, 10), 1, 50), // weak B
    loop_length: clamp(randn(80, 40), 20, 250),
    loop_width: clamp(randn(4, 1.5), 1, 10),
    velocity_amplitude: clamp(randn(5, 3), 0.5, 15), // small amplitude
    wave_period: clamp(randn(400, 150), 200, 800),
    nonthermal_velocity: clamp(randn(10, 5), 2, 25),
    emission_measure: clamp(randn(2e26, 1e26), 1e25, 1e27),
    has_kink_oscillation: Math.random() < 0.1,
    label: 0,
  }
}

async function main() {
  console.log(`Generating ${NUM_SNAPSHOTS} snapshots → ${SNAPSHOTS_PATH}`)

  await mkdir(DATASET_DIR, { recursive: true })

  // Truncate the output file up front so re-runs don't append to stale data.
  await writeFile(SNAPSHOTS_PATH, '', { flag: 'w' })

  let lines = ''
  let positiveCount = 0
  for (let i = 0; i < NUM_SNAPSHOTS; i++) {
    const snap = generateSnapshot(i)
    if (snap.label === 1) positiveCount++
    lines += `${JSON.stringify(snap)}\n`

    // Write in batches to avoid huge string
    if (lines.length > 1_000_000) {
      await writeFile(SNAPSHOTS_PATH, lines, { flag: 'a' })
      lines = ''
    }
  }
  if (lines) {
    await writeFile(SNAPSHOTS_PATH, lines, { flag: 'a' })
  }

  console.log(
    `Done: ${NUM_SNAPSHOTS} snapshots (${positiveCount} positive, ${NUM_SNAPSHOTS - positiveCount} negative)`,
  )
  console.log(`Positive rate: ${((positiveCount / NUM_SNAPSHOTS) * 100).toFixed(1)}%`)

  // Write the shared eval script
  const evalScript = `#!/usr/bin/env python3
"""Shared evaluation script for hypothesis filter functions.

Usage:
    python3 eval.py <filter_file>

The filter file must define a function:  filter(snapshot: dict) -> bool

This script:
1. Loads snapshots.jsonl from the same directory.
2. Imports the filter function from the specified file.
3. Evaluates every snapshot, computing TP/FP/FN and F1.
4. Prints JSON result + first 10 counterexamples.
"""

import json
import os
import sys
import time
import importlib.util
from pathlib import Path

DATASET_PATH = Path(__file__).parent / "snapshots.jsonl"


def load_filter(filter_path: str):
    """Import the filter function from the given Python file."""
    spec = importlib.util.spec_from_file_location("hypothesis_filter", filter_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "filter"):
        raise RuntimeError(f"No 'filter' function found in {filter_path}")
    return mod.filter


def load_snapshots():
    """Load all snapshots from the JSONL file."""
    snapshots = []
    with open(DATASET_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                snapshots.append(json.loads(line))
    return snapshots


def evaluate(filter_fn, snapshots):
    """Run filter on all snapshots, compute TP/FP/FN/F1."""
    tp, fp, fn = 0, 0, 0
    counterexamples = []

    for snap in snapshots:
        try:
            predicted = bool(filter_fn(snap))
        except Exception:
            predicted = False

        actual = snap.get("label", 0) == 1

        if predicted and actual:
            tp += 1
        elif predicted and not actual:
            fp += 1
            if len(counterexamples) < 10:
                counterexamples.append({
                    "snapshot_id": snap.get("snapshot_id"),
                    "reason": "FP: filter predicted heating but ground truth is quiescent",
                    "expected": False,
                    "actual": True,
                    "params": {k: v for k, v in snap.items() if k != "label"},
                })
        elif not predicted and actual:
            fn += 1
            if len(counterexamples) < 10:
                counterexamples.append({
                    "snapshot_id": snap.get("snapshot_id"),
                    "reason": "FN: filter predicted quiescent but ground truth is heating event",
                    "expected": True,
                    "actual": False,
                    "params": {k: v for k, v in snap.items() if k != "label"},
                })

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "counterexamples": counterexamples,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 eval.py <filter_file>", file=sys.stderr)
        sys.exit(1)

    filter_path = sys.argv[1]
    filter_fn = load_filter(filter_path)
    snapshots = load_snapshots()

    t0 = time.time()
    result = evaluate(filter_fn, snapshots)
    elapsed_ms = int((time.time() - t0) * 1000)

    output = {
        "hypoId": os.environ.get("HYPO_ID", "unknown"),
        "f1": result["f1"],
        "truePositives": result["tp"],
        "falsePositives": result["fp"],
        "falseNegatives": result["fn"],
        "counterexamples": result["counterexamples"],
        "logs": f"Evaluated {len(snapshots)} snapshots in {elapsed_ms}ms. P={result['precision']} R={result['recall']} F1={result['f1']}",
        "executionMs": elapsed_ms,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
`

  await writeFile(EVAL_SCRIPT_PATH, evalScript)
  console.log(`Eval script written → ${EVAL_SCRIPT_PATH}`)
  console.log('\nExplore agent usage:')
  console.log('  1. Write filter.py with: def filter(snapshot: dict) -> bool: ...')
  console.log('  2. Run: python3 data/dataset/eval.py filter.py')
}

main().catch(console.error)
