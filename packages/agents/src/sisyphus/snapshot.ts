import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { getProjectDir, getRoundsDir } from '@open-scientist/config'

/** Shape of one tournament round snapshot (persisted for the API / UI layer). */
export interface RoundSnapshot {
  round: number
  runId: string
  projectId: string
  bestF1: number
  leadingHypoId: string | null
  survivingCount: number
  hypotheses: Array<{
    id: string
    statement: string
    f1: number | null
    status: string
    parentId: string | null
    round: number
  }>
  convergenceHistory: Array<{ round: number; bestF1: number; count: number }>
  /** ISO 8601 timestamp when the snapshot was written. */
  capturedAt: string
}

/**
 * Persist a per-round snapshot to
 * `data/projects/<projectId>/rounds/<round>/snapshot.json`.
 *
 * Plain async fn — fs failures bubble to the caller, which can wrap retry if
 * desired. Imports `node:fs/promises` + `@open-scientist/config` statically
 * (no VM sandbox anymore).
 */
export async function snapshotStep(snapshot: RoundSnapshot): Promise<{ path: string }> {
  const dir = getRoundsDir(snapshot.projectId, snapshot.round)
  await mkdir(dir, { recursive: true })
  const path = `${dir}/snapshot.json`
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8')
  return { path }
}

/**
 * Read the latest (highest round number) snapshot for a given project + run.
 *
 * Scans `data/projects/<projectId>/rounds/ROUND_N/snapshot.json` across all
 * round directories, filters to those matching `runId`, and returns the one
 * with the highest `round` field. Returns `null` when no snapshots exist
 * (e.g. a fresh run that never completed Round 1, or the project dir doesn't
 * exist).
 *
 * Used by the resume-from-snapshot entry point: after a dev-mode crash, the
 * API layer calls this to find the last persisted round, then passes the
 * result to `tournamentWorkflow` as `resumeFrom` to skip already-completed
 * rounds.
 */
export async function readLatestSnapshot(
  projectId: string,
  runId: string,
): Promise<RoundSnapshot | null> {
  const roundsRoot = `${getProjectDir(projectId)}/rounds`
  let entries: string[]
  try {
    entries = await readdir(roundsRoot)
  } catch {
    // Directory doesn't exist — no snapshots yet.
    return null
  }

  // Collect all snapshot.json files that match the runId, pick the highest round.
  let latest: RoundSnapshot | null = null
  for (const entry of entries) {
    const snapshotPath = `${roundsRoot}/${entry}/snapshot.json`
    let raw: string
    try {
      raw = await readFile(snapshotPath, 'utf-8')
    } catch {
      continue // Not a round dir or missing snapshot.json — skip.
    }
    let snapshot: RoundSnapshot
    try {
      snapshot = JSON.parse(raw) as RoundSnapshot
    } catch {
      continue // Corrupt JSON — skip.
    }
    if (snapshot.runId !== runId) continue
    if (latest === null || snapshot.round > latest.round) {
      latest = snapshot
    }
  }
  return latest
}
