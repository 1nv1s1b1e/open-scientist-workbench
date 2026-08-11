---
name: solar-physics-rag
description: Construct falsifiable solar-physics hypotheses from the configured local observation pack or legacy JW-FD demonstration features.
---

# Solar-physics hypothesis generation

## Scientific phenomenon and local observation pack

When the task is a natural-language solar phenomenon or refers to a local
observation pack, do **not** require the user to supply a `sourceId`, FITS path,
or fixed template. First call `searchLocalSolarData` and then
`checkLocalSolarCoverage` for the named or inferred active region.

- Use returned case and asset IDs only as data provenance.
- AIA/HMI file coverage is not a physical measurement and is never by itself
  evidence for Alfvén-wave heating, nanoflares, or any mixture of mechanisms.
- If WCS alignment, calibration, spectroscopy, time-series products, or MHD
  products are missing, state `unknown` and turn the gap into a validation task.
- Do not invent a paper, a spectral diagnostic, a derived quantity, or a
  counterexample. A local data tool cannot download data or read arbitrary
  files.

For this path, propose a small set of competing or coupled mechanisms with
observable predictions and falsification conditions. The legacy `pythonCode`
field is a compatibility placeholder only; it is not an analysis of FITS data
and must not be presented as a scientific result.

## Legacy JW-FD demonstration path


Use RAG tools to retrieve relevant papers and existing hypotheses. Keep claims
calibrated: the local JW-FD directory is a labeled demonstration subset, not
the complete JW-FD release.

## Required hypothesis structure for JW-FD

Every hypothesis must include:

1. a physical mechanism stated without claiming causality from this subset;
2. observable predictions using only fields present in the dataset manifest;
3. falsification conditions and at least one expected counterexample;
4. a pure Python `filter(snapshot: dict) -> bool` function.

Before writing the filter, read the dataset manifest supplied by the workflow:

```text
<datasetDir>/dataset_manifest.json
```

Use exact feature names from `featureColumns`. Do not invent aliases such as
`usflux`, `mean_gamma`, or `magnitude` when they are absent. Do not use
`targets.jsonl`, target columns, or any ground-truth label/class field inside
the filter.

## Evidence discipline

- Search papers and existing hypotheses before proposing a duplicate.
- Attach each scientific claim to a retrieved source or mark it as an
  unverified candidate mechanism.
- Do not fabricate citations, measurements, units, time windows, or sample IDs.
- Treat F1 as a deterministic risk-signal metric for this snapshot and target
  definition, not as a causal or complete-dataset result.

## Output

Submit a small diverse hypothesis pool, normally covering different candidate
mechanisms. Each item must contain `statement`, `pythonCode`, `parentId`,
`round`, and a rationale describing the evidence and falsification plan.
