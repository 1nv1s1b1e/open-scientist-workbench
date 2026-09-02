import {
  type ScientificHumanControl,
  type ScientificHumanControlOptions,
  createInMemoryScientificHumanControl,
} from '@open-scientist/agents'

/**
 * Process-local registry of per-run human control surfaces (pause / steering
 * / approval gate). A control is created when a run starts and removed when
 * the run settles, so the map can never accumulate across runs.
 *
 * The scientific loop itself never requires this channel: with no gate armed
 * and no pause requested, the loop reaches closure fully automatically.
 */
const controls = new Map<string, ScientificHumanControl>()

export function createRunHumanControl(
  options: ScientificHumanControlOptions,
): ScientificHumanControl {
  const control = createInMemoryScientificHumanControl(options)
  controls.set(options.runId, control)
  return control
}

export function getRunHumanControl(runId: string): ScientificHumanControl | undefined {
  return controls.get(runId)
}

export function removeRunHumanControl(runId: string): void {
  const control = controls.get(runId)
  if (control) {
    control.close()
    controls.delete(runId)
  }
}
