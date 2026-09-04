import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const MONOREPO_ROOT = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)))

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

/**
 * Normalize an absolute path under the monorepo root to a root-relative
 * POSIX path so records stored in project databases stay portable across
 * platforms (Windows dev machines vs Linux servers). Paths outside the
 * monorepo are returned resolved-but-absolute.
 */
export function toRepoRelativePath(absolutePath: string): string {
  const normalized = resolve(absolutePath)
  const rel = relative(MONOREPO_ROOT, normalized)
  if (!rel || rel.startsWith('..')) return normalized
  return rel.split(sep).join('/')
}

/**
 * Resolve a possibly repo-relative stored path back to an absolute path on
 * the current platform. Absolute inputs pass through unchanged, so records
 * written before the relative-path convention keep working.
 */
export function resolveRepoPath(storedPath: string): string {
  if (isAbsolute(storedPath)) return resolve(storedPath)
  return resolve(MONOREPO_ROOT, storedPath)
}
