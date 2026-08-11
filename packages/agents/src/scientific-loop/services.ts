import type { UIMessageChunk } from 'ai'
import type {
  EvidenceRecord,
  PhenomenonInput,
  ScientificHypothesis,
  ScientificCorrection,
  ValidationTask,
} from '@open-scientist/schema'
import type { ScientificGraphRuntime } from '../orchestration/langgraph-runtime.ts'
import type { ScientificGraphState } from './graph-state.ts'
import type {
  EvidenceAgent,
  EvidenceAgentOutput,
} from './evidence-workgroup.ts'
import type { ScientificWorkingContext } from './context-builder.ts'

export interface HypothesisGenerationContext {
  projectId: string
  runId: string
  round: number
  phenomenon: PhenomenonInput
  context: ScientificWorkingContext
  existingHypotheses: readonly ScientificHypothesis[]
  signal?: AbortSignal
}

/** A-stage may decline to produce candidates and explain the factual boundary. */
export interface HypothesisGenerationResult {
  hypotheses: ScientificHypothesis[]
  corrections?: ScientificCorrection[]
}

export interface EvidenceWorkgroupContext {
  projectId: string
  runId: string
  round: number
  phenomenon: PhenomenonInput
  context: ScientificWorkingContext
  state: ScientificGraphState
  signal?: AbortSignal
}

export interface SynthesisContext {
  projectId: string
  runId: string
  round: number
  phenomenon: PhenomenonInput
  context: ScientificWorkingContext
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
  signal?: AbortSignal
}

export interface PlanningContext {
  projectId: string
  runId: string
  round: number
  phenomenon: PhenomenonInput
  context: ScientificWorkingContext
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
  conclusion: string
  signal?: AbortSignal
}

export interface ScientificGraphDependencies {
  /** Stateless A-stage service. It receives the current projection only. */
  generateHypotheses: (
    context: Readonly<HypothesisGenerationContext>,
  ) => HypothesisGenerationResult | ScientificHypothesis[] | Promise<HypothesisGenerationResult | ScientificHypothesis[]>
  /** B agents are registered capabilities, not memory owners. */
  evidenceAgents: readonly EvidenceAgent[] | ((
    context: Readonly<EvidenceWorkgroupContext>,
  ) => readonly EvidenceAgent[] | Promise<readonly EvidenceAgent[]>)
  planValidation?: (
    context: Readonly<PlanningContext>,
  ) => ValidationTask[] | Promise<ValidationTask[]>
  /**
   * Return true only when this runtime has a registered implementation that
   * can execute the task now. Planned external work stays visible, but must
   * not be used to manufacture another automated round.
   */
  canExecuteValidationTask?: (
    task: Readonly<ValidationTask>,
  ) => boolean | Promise<boolean>
  synthesizeConclusion?: (
    context: Readonly<SynthesisContext>,
  ) => string | Promise<string>
  /** The application layer may verify that every referenced record exists. */
  verifyProvenance?: (
    evidence: EvidenceRecord,
    state: ScientificGraphState,
  ) => boolean | Promise<boolean>
}

export interface ScientificGraphInput {
  projectId: string
  runId: string
  phenomenon?: PhenomenonInput
  maxRounds?: number
  emitChunk?: (chunk: UIMessageChunk) => void
  abortSignal?: AbortSignal
  /** Injected in tests or resumable callers; defaults to a project runtime. */
  runtime?: ScientificGraphRuntime
  /** Continue from the latest checkpoint for this project/run thread. */
  resume?: boolean
}

export type ScientificEvidenceOutput = EvidenceAgentOutput
