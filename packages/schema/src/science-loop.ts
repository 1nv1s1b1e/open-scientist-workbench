import { z } from 'zod'

export const ScienceLoopPhaseSchema = z.enum([
  'question',
  'hypothesis',
  'evidence',
  'evaluation',
  'counterexample',
  'revision',
  'validation_plan',
  'completed',
  'failed',
])
export type ScienceLoopPhase = z.infer<typeof ScienceLoopPhaseSchema>

export const ScienceLoopEventSchema = z.object({
  sequence: z.number().int().positive(),
  phase: ScienceLoopPhaseSchema,
  payload: z.record(z.string(), z.unknown()),
})
export type ScienceLoopEvent = z.infer<typeof ScienceLoopEventSchema>

export const ScienceLoopStateSchema = z.object({
  runId: z.string().min(1),
  question: z.string().min(1),
  datasetId: z.string().min(1),
  datasetManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  phase: ScienceLoopPhaseSchema,
  events: z.array(ScienceLoopEventSchema),
})
export type ScienceLoopState = z.infer<typeof ScienceLoopStateSchema>

const ALLOWED_TRANSITIONS: Record<ScienceLoopPhase, ScienceLoopPhase[]> = {
  question: ['hypothesis', 'failed'],
  hypothesis: ['evidence', 'failed'],
  evidence: ['evaluation', 'failed'],
  evaluation: ['counterexample', 'revision', 'failed'],
  counterexample: ['revision', 'failed'],
  revision: ['validation_plan', 'failed'],
  validation_plan: ['hypothesis', 'completed', 'failed'],
  completed: [],
  failed: [],
}

export interface CreateScienceLoopStateInput {
  runId: string
  question: string
  datasetId: string
  datasetManifestSha256: string
}

export function createScienceLoopState(input: CreateScienceLoopStateInput): ScienceLoopState {
  return ScienceLoopStateSchema.parse({
    ...input,
    phase: 'question',
    events: [],
  })
}

export function transitionScienceLoop(
  state: ScienceLoopState,
  nextPhase: ScienceLoopPhase,
  payload: Record<string, unknown>,
): ScienceLoopState {
  const allowed = ALLOWED_TRANSITIONS[state.phase]
  if (!allowed.includes(nextPhase)) {
    throw new Error(`Invalid science-loop transition: ${state.phase} -> ${nextPhase}`)
  }

  return ScienceLoopStateSchema.parse({
    ...state,
    phase: nextPhase,
    events: [
      ...state.events,
      { sequence: state.events.length + 1, phase: nextPhase, payload },
    ],
  })
}
