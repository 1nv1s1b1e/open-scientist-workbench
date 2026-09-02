import type { UIMessageChunk } from 'ai'
import type {
  EvidenceRecord,
  HypothesisCoverageAudit,
  PhenomenonInput,
  ScientificHypothesis,
  ScientificCorrection,
  ValidationTask,
} from '@open-scientist/schema'
import type { ScientificGraphRuntime } from '../orchestration/langgraph-runtime.ts'
import type { ScientificGraphState } from './graph-state.ts'
import type { EvidenceAgent, EvidenceAgentOutput } from './evidence-workgroup.ts'
import type { ScientificWorkingContext } from './context-builder.ts'
import type { ScientificHumanChannel, ScientificSteeringMessage } from './human-channel.ts'

export interface HypothesisGenerationContext {
  projectId: string
  runId: string
  round: number
  phenomenon: PhenomenonInput
  context: ScientificWorkingContext
  existingHypotheses: readonly ScientificHypothesis[]
  /**
   * Advisory human steering messages drained at this round's entry (tagged
   * with `injectedRound`). The model path may use them to bias candidate
   * emphasis; the deterministic path records them without consuming them.
   * Either way they can never alter gate verdicts or evidence content.
   */
  steering?: readonly ScientificSteeringMessage[]
  signal?: AbortSignal
}

/** A-stage may decline to produce candidates and explain the factual boundary. */
export interface HypothesisGenerationResult {
  hypotheses: ScientificHypothesis[]
  corrections?: ScientificCorrection[]
  coverageAudit?: HypothesisCoverageAudit
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
  ) =>
    | HypothesisGenerationResult
    | ScientificHypothesis[]
    | Promise<HypothesisGenerationResult | ScientificHypothesis[]>
  /** B agents are registered capabilities, not memory owners. */
  evidenceAgents:
    | readonly EvidenceAgent[]
    | ((
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
  canExecuteValidationTask?: (task: Readonly<ValidationTask>) => boolean | Promise<boolean>
  synthesizeConclusion?: (context: Readonly<SynthesisContext>) => string | Promise<string>
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
  /**
   * Optional human-in-the-loop channel (pause / steering / armed approval
   * gate). When omitted the loop is fully automatic — no human participation
   * is required to reach closure. Even when present, steering is advisory
   * and an armed gate only decides whether the loop continues.
   */
  humanChannel?: ScientificHumanChannel
}

export type ScientificEvidenceOutput = EvidenceAgentOutput
