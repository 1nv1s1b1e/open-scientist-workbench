import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { env } from './env.ts'

// Detect monorepo root by walking up from this source file looking for
// pnpm-workspace.yaml. This makes `BASE_DIR` (and thus `data/`, `global.sqlite`,
// per-project dirs) resolve consistently to `<monorepo-root>/data` regardless
// of which workspace package's cwd the process started from (e.g. `tsx watch`
// runs from `apps/api`, but data must live at the repo root).
export function findMonorepoRoot(start: string): string {
  let dir = start
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start // reached filesystem root, fall back
    dir = parent
  }
}

const MONOREPO_ROOT = findMonorepoRoot(dirname(new URL(import.meta.url).pathname))

export function getBaseDir(): string {
  // Resolve BASE_DIR relative to the monorepo root so that `./data` always
  // means `<repo-root>/data`, not `<cwd>/data`.
  return resolve(MONOREPO_ROOT, env.BASE_DIR)
}

export function getProjectDir(name: string): string {
  return resolve(getBaseDir(), 'projects', name)
}

export function getWorkspaceDir(project: string, runId: string, hypoId: string): string {
  return resolve(getProjectDir(project), 'runs', runId, hypoId)
}

export function getMhdDir(project: string): string {
  return resolve(getProjectDir(project), 'mhd')
}

export function getGlobalDbPath(): string {
  return resolve(getBaseDir(), 'global.sqlite')
}

export function getProjectDbPath(project: string): string {
  return resolve(getProjectDir(project), 'db.sqlite')
}

export function getRoundsDir(project: string, round: number): string {
  return resolve(getProjectDir(project), 'rounds', String(round))
}

/**
 * Dataset directory — contains snapshots.jsonl, eval.py, and .venv.
 * Defaults to `<BASE_DIR>/dataset` (i.e. `data/dataset/`).
 * Override via env `DATASET_DIR` for custom locations.
 */
export function getDatasetDir(): string {
  if (process.env.DATASET_DIR) return resolve(process.env.DATASET_DIR)
  return resolve(getBaseDir(), 'dataset')
}
