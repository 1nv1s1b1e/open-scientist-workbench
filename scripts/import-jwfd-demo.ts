#!/usr/bin/env tsx

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  buildJwfdSnapshotArtifacts,
  getDatasetDir,
  renderJwfdEvalScript,
} from '../packages/config/src/index.ts'

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

async function main(): Promise<void> {
  const sourcePath = process.env.JWFD_CSV_PATH
  if (!sourcePath) {
    throw new Error('JWFD_CSV_PATH must point to a read-only JW-FD CSV file')
  }

  const targetColumn = process.env.JWFD_TARGET_COLUMN ?? 'flare_label_C1.0_72hr'
  const outputDir = resolve(process.env.DATASET_DIR ?? getDatasetDir())
  const csvText = await readFile(resolve(sourcePath), 'utf8')
  const artifacts = buildJwfdSnapshotArtifacts(csvText, targetColumn)

  const snapshotsText = `${artifacts.snapshots.map((row) => JSON.stringify(row)).join('\n')}\n`
  const targetsText = `${artifacts.targets.map((row) => JSON.stringify(row)).join('\n')}\n`
  const manifest = {
    ...artifacts.manifest,
    datasetId: process.env.JWFD_DATASET_ID ?? 'jwfd-png-demo',
    sourceFile: basename(resolve(sourcePath)),
    sourceSha256: sha256(csvText),
    snapshotsSha256: sha256(snapshotsText),
    targetsSha256: sha256(targetsText),
  }

  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(resolve(outputDir, 'snapshots.jsonl'), snapshotsText, 'utf8'),
    writeFile(resolve(outputDir, 'targets.jsonl'), targetsText, 'utf8'),
    writeFile(
      resolve(outputDir, 'dataset_manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    ),
    writeFile(resolve(outputDir, 'eval.py'), renderJwfdEvalScript(), 'utf8'),
  ])

  console.log(
    JSON.stringify({
      outputDir,
      sourceFile: manifest.sourceFile,
      sourceSha256: manifest.sourceSha256,
      targetColumn,
      rowCount: manifest.rowCount,
      positiveCount: manifest.positiveCount,
      negativeCount: manifest.negativeCount,
    }),
  )
}

await main()
