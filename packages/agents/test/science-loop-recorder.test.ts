import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createScienceLoopState } from '@open-scientist/schema'
import {
  createScienceLoopRecorder,
  createTournamentScienceLoopRecorder,
} from '../src/harness/recorder.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('science loop recorder', () => {
  it('persists ordered phase events as replayable JSONL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'os-loop-recorder-'))
    tempDirs.push(dir)
    const state = createScienceLoopState({
      runId: 'run-1',
      question: 'How can competing coronal-heating mechanisms be distinguished?',
      datasetId: 'jwfd-png-demo',
      datasetManifestSha256: 'a'.repeat(64),
    })
    const recorder = createScienceLoopRecorder(state, join(dir, 'science-loop.jsonl'))

    await recorder.transition('hypothesis', { hypothesisIds: ['h1', 'h2'] })
    await recorder.transition('evidence', { sourceIds: ['dataset:jwfd-png-demo'] })

    const lines = (await readFile(join(dir, 'science-loop.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ sequence: 1, phase: 'hypothesis' })
    expect(lines[1]).toMatchObject({ sequence: 2, phase: 'evidence' })
    expect(recorder.getState().phase).toBe('evidence')
  })

  it('binds a tournament recorder to the dataset manifest and project run path', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'os-loop-base-'))
    const datasetDir = await mkdtemp(join(tmpdir(), 'os-loop-dataset-'))
    tempDirs.push(baseDir, datasetDir)
    process.env.BASE_DIR = baseDir
    process.env.DATASET_DIR = datasetDir
    await writeFile(
      join(datasetDir, 'dataset_manifest.json'),
      JSON.stringify({ datasetId: 'jwfd-png-demo', sourceSha256: 'b'.repeat(64) }),
    )

    const recorder = await createTournamentScienceLoopRecorder({
      projectId: 'coronal-heating',
      runId: 'run-1',
      question: 'Which observations distinguish Alfvén-wave and nanoflare heating?',
    })
    await recorder.transition('hypothesis', { hypothesisIds: ['h1'] })

    const output = join(
      baseDir,
      'projects',
      'coronal-heating',
      'runs',
      'run-1',
      'science-loop.jsonl',
    )
    const events = (await readFile(output, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { phase: string; payload: Record<string, unknown> })
    expect(events[0]?.phase).toBe('hypothesis')
    expect(events[0]?.payload).toMatchObject({
      hypothesisIds: ['h1'],
    })
    await recorder.transition('evidence', {
      sourceIds: ['dataset:jwfd-png-demo'],
    })
    const updatedEvents = (await readFile(output, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { phase: string; payload: Record<string, unknown> })
    expect(updatedEvents[1]?.payload).toMatchObject({
      datasetId: 'jwfd-png-demo',
      datasetManifestSha256: 'b'.repeat(64),
    })
    delete process.env.BASE_DIR
    delete process.env.DATASET_DIR
  })
})
