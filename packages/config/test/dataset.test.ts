import { describe, expect, it } from 'vite-plus/test'
import { buildJwfdSnapshotArtifacts, renderJwfdEvalScript } from '../src/dataset.ts'

const CSV = [
  'Gradient mean,Total unsigned flux,flare_label_C1.0_72hr,flare_class_72hr,image_filename,image_path',
  '1.5,100,0,A,AR1139_000000.png,./1139/AR1139_000000.png',
  '2.5,200,1,C1.0,AR1142_000000.png,./1142/AR1142_000000.png',
].join('\n')

describe('JW-FD dataset adapter', () => {
  it('keeps source features and separates the selected target from model inputs', () => {
    const result = buildJwfdSnapshotArtifacts(CSV, 'flare_label_C1.0_72hr')

    expect(result.snapshots).toEqual([
      {
        snapshot_id: 'AR1139_000000.png',
        'Gradient mean': 1.5,
        'Total unsigned flux': 100,
        image_filename: 'AR1139_000000.png',
        image_path: './1139/AR1139_000000.png',
      },
      {
        snapshot_id: 'AR1142_000000.png',
        'Gradient mean': 2.5,
        'Total unsigned flux': 200,
        image_filename: 'AR1142_000000.png',
        image_path: './1142/AR1142_000000.png',
      },
    ])
    expect(result.targets).toEqual([
      { snapshot_id: 'AR1139_000000.png', target: 0 },
      { snapshot_id: 'AR1142_000000.png', target: 1 },
    ])
    expect(result.manifest).toMatchObject({
      targetColumn: 'flare_label_C1.0_72hr',
      sampleIdColumn: 'image_filename',
      rowCount: 2,
      positiveCount: 1,
    })
  })

  it('rejects a missing target column instead of silently selecting a label', () => {
    expect(() => buildJwfdSnapshotArtifacts(CSV, 'flare_label_M1.0_72hr')).toThrow(
      /missing target column/,
    )
  })

  it('rejects duplicate source sample identifiers', () => {
    const duplicate = CSV.replace('AR1142_000000.png', 'AR1139_000000.png')

    expect(() => buildJwfdSnapshotArtifacts(duplicate, 'flare_label_C1.0_72hr')).toThrow(
      /duplicate sample identifier/,
    )
  })

  it('renders an evaluator that reads the target index and preserves filter errors', () => {
    const evaluator = renderJwfdEvalScript()

    expect(evaluator).toContain('targets.jsonl')
    expect(evaluator).toContain('raise RuntimeError')
    expect(evaluator).toContain('counterexamples')
  })
})
