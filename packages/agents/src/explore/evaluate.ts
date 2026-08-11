import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { EvalResultSchema, type EvalResult } from '@open-scientist/schema'

const execFileAsync = promisify(execFile)

export interface EvaluatePythonFilterInput {
  datasetDir: string
  filterCode: string
  hypoId: string
}

/**
 * Re-evaluate the hypothesis code outside the model conversation.
 *
 * The returned metrics and counterexamples are always parsed from the shared
 * evaluator output. Model-submitted numeric fields are intentionally ignored.
 */
export async function evaluatePythonFilter({
  datasetDir,
  filterCode,
  hypoId,
}: EvaluatePythonFilterInput): Promise<EvalResult> {
  const filterDir = await mkdtemp(join(tmpdir(), 'open-scientist-filter-'))
  const filterPath = join(filterDir, 'filter.py')
  const evalPath = join(datasetDir, 'eval.py')

  try {
    await writeFile(filterPath, filterCode, 'utf8')
    const { stdout, stderr } = await execFileAsync(process.env.PYTHON ?? 'python', [evalPath, filterPath], {
      cwd: datasetDir,
      env: { ...process.env, HYPO_ID: hypoId },
      maxBuffer: 4 * 1024 * 1024,
    })
    const output = stdout.trim().split(/\r?\n/).at(-1)
    if (!output) throw new Error(`deterministic evaluator returned no JSON; stderr: ${stderr}`)
    return EvalResultSchema.parse(JSON.parse(output))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`deterministic evaluation failed for ${hypoId}: ${message}`)
  } finally {
    await rm(filterDir, { recursive: true, force: true })
  }
}
