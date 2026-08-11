import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderJwfdEvalScript } from '@open-scientist/config'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { evaluatePythonFilter } from '../src/explore/evaluate.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('deterministic Explore evaluation', () => {
  it('recomputes metrics from the filter and target index', async () => {
    const datasetDir = await mkdtemp(join(tmpdir(), 'os-eval-dataset-'))
    tempDirs.push(datasetDir)
    await writeFile(
      join(datasetDir, 'snapshots.jsonl'),
      '{"snapshot_id":"s1","Total unsigned flux":100}\n{"snapshot_id":"s2","Total unsigned flux":200}\n',
    )
    await writeFile(
      join(datasetDir, 'targets.jsonl'),
      '{"snapshot_id":"s1","target":0}\n{"snapshot_id":"s2","target":1}\n',
    )
    await writeFile(join(datasetDir, 'eval.py'), renderJwfdEvalScript())

    const result = await evaluatePythonFilter({
      datasetDir,
      filterCode: 'def filter(snapshot):\n    return snapshot["Total unsigned flux"] > 150\n',
      hypoId: 'h1',
    })

    expect(result).toMatchObject({
      hypoId: 'h1',
      f1: 1,
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      candidateSnapshots: [],
    })
  })

  it('returns only manifest-backed candidate metadata for downstream evidence alignment', async () => {
    const datasetDir = await mkdtemp(join(tmpdir(), 'os-eval-dataset-'))
    tempDirs.push(datasetDir)
    await writeFile(
      join(datasetDir, 'dataset_manifest.json'),
      JSON.stringify({
        featureColumns: ['active_region', 'timestamp', 'wavelength'],
      }),
    )
    await writeFile(
      join(datasetDir, 'snapshots.jsonl'),
      '{"snapshot_id":"s1","active_region":1142,"timestamp":"2026-01-01T00:00:00Z","wavelength":193}\n{"snapshot_id":"s2","active_region":1143,"timestamp":"2026-01-01T00:12:00Z","wavelength":171}\n',
    )
    await writeFile(
      join(datasetDir, 'targets.jsonl'),
      '{"snapshot_id":"s1","target":1}\n{"snapshot_id":"s2","target":0}\n',
    )
    await writeFile(join(datasetDir, 'eval.py'), renderJwfdEvalScript())

    const result = await evaluatePythonFilter({
      datasetDir,
      filterCode: 'def filter(snapshot):\n    return snapshot["active_region"] == 1142\n',
      hypoId: 'h-evidence',
    })

    expect(result.candidateSnapshots).toEqual([
      {
        snapshotId: 's1',
        activeRegion: '1142',
        timestamp: '2026-01-01T00:00:00Z',
        wavelength: '193',
      },
    ])
  })

  it('fails with the sample id when a filter raises instead of fabricating metrics', async () => {
    const datasetDir = await mkdtemp(join(tmpdir(), 'os-eval-dataset-'))
    tempDirs.push(datasetDir)
    await writeFile(join(datasetDir, 'snapshots.jsonl'), '{"snapshot_id":"bad","x":1}\n')
    await writeFile(join(datasetDir, 'targets.jsonl'), '{"snapshot_id":"bad","target":1}\n')
    await writeFile(join(datasetDir, 'eval.py'), renderJwfdEvalScript())

    await expect(
      evaluatePythonFilter({
        datasetDir,
        filterCode: 'def filter(snapshot):\n    return snapshot["missing"]\n',
        hypoId: 'h2',
      }),
    ).rejects.toThrow(/bad/)
  })
})
