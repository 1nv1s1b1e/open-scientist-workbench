---
name: fits-snapshot-search
description: Evaluate a Python hypothesis filter against the configured JW-FD snapshot and target artifacts.
---

# Configured dataset evaluation

This is a legacy JW-FD evaluation skill. Do not use it for a scientific
phenomenon backed by `coronal-starter-v1`; that path uses the local solar-data
tools and must retain `unknown` until a calibrated observation-analysis product
exists.


Use this skill for Explore evaluation. The dataset is selected by the workflow
prompt; do not assume a fixed sample count, source, label, or feature name.

## Dataset contract

Before writing code, read:

```text
<datasetDir>/dataset_manifest.json
<datasetDir>/snapshots.jsonl
```

Each snapshot has a stable `snapshot_id` and source feature columns. The target
index is stored separately in `targets.jsonl` and is used only by `eval.py`.
Never read a target or ground-truth label from `filter()`.

The manifest is the authority for the selected target column, source hash,
feature columns, row count, and positive/negative counts. Do not invent missing
fields or describe a demo subset as a complete dataset.

## Evaluation loop

Write only the hypothesis filter in the sandbox workspace:

```python
def filter(snapshot: dict) -> bool:
    value = snapshot.get("Total unsigned flux", 0)
    return float(value) > 0
```

Run the shared evaluator using the absolute path supplied by the prompt:

```bash
python <datasetDir>/eval.py filter.py
```

The evaluator returns JSON containing `f1`, `truePositives`,
`falsePositives`, `falseNegatives`, `counterexamples`, `logs`, and
`executionMs`. If the filter raises an exception, preserve the sample ID and
fix the filter; do not turn the exception into a false prediction.

Counterexamples must retain their source `snapshotId` and explain whether the
case is a false positive or false negative. Do not invent physical properties
that are not present in the snapshot.

## Submission rules

- Call `submit_result` after the evaluation loop.
- Copy numeric metrics and counterexamples from the evaluator output.
- The server independently reruns the submitted hypothesis code; its result
  is authoritative over model-provided numeric fields.
- Do not generate synthetic data or write a second evaluation script.
- Treat this JW-FD demo subset as a method/risk-signal demonstration, not as a
  complete-dataset scientific conclusion.
