import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDatasetDir, getProjectDir } from '@open-scientist/config'
import {
  type ScienceLoopEvent,
  type ScienceLoopPhase,
  type ScienceLoopState,
  transitionScienceLoop,
  createScienceLoopState,
} from '@open-scientist/schema'

export interface ScienceLoopRecorder {
  getState(): ScienceLoopState
  transition(phase: ScienceLoopPhase, payload: Record<string, unknown>): Promise<ScienceLoopState>
}

export interface CreateTournamentScienceLoopRecorderInput {
  projectId: string
  runId: string
  question: string
  datasetDir?: string
}

/** Persist deterministic loop events without putting model-generated metrics in the event log. */
export function createScienceLoopRecorder(
  initialState: ScienceLoopState,
  outputPath: string,
): ScienceLoopRecorder {
  let state = initialState
  let queue: Promise<void> = Promise.resolve()

  return {
    getState: () => state,
    transition: async (phase, payload) => {
      let nextState: ScienceLoopState | undefined
      const operation = queue.then(async () => {
        const eventPayload =
          phase === 'evidence'
            ? {
                datasetId: state.datasetId,
                datasetManifestSha256: state.datasetManifestSha256,
                ...payload,
              }
            : payload
        nextState = transitionScienceLoop(state, phase, eventPayload)
        const event = nextState.events.at(-1) as ScienceLoopEvent
        await mkdir(dirname(outputPath), { recursive: true })
        await appendFile(outputPath, `${JSON.stringify(event)}\n`, 'utf8')
        state = nextState
      })
      queue = operation.catch(() => undefined)
      await operation
      return nextState as ScienceLoopState
    },
  }
}

export async function createTournamentScienceLoopRecorder({
  projectId,
  runId,
  question,
  datasetDir = getDatasetDir(),
}: CreateTournamentScienceLoopRecorderInput): Promise<ScienceLoopRecorder> {
  const manifestPath = join(datasetDir, 'dataset_manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    datasetId?: unknown
    snapshotsSha256?: unknown
    sourceSha256?: unknown
  }
  const datasetId = manifest.datasetId
  const datasetManifestSha256 = manifest.snapshotsSha256 ?? manifest.sourceSha256
  if (typeof datasetId !== 'string' || typeof datasetManifestSha256 !== 'string') {
    throw new Error(`Invalid dataset manifest: ${manifestPath}`)
  }

  const state = createScienceLoopState({
    runId,
    question,
    datasetId,
    datasetManifestSha256,
  })
  return createScienceLoopRecorder(
    state,
    join(getProjectDir(projectId), 'runs', runId, 'science-loop.jsonl'),
  )
}
