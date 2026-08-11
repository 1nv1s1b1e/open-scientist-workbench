import { getDatasetDir, type AgentRuntimeConfig, type ModelArg } from '@open-scientist/config'
import { ensureIndexes } from '@open-scientist/helix'
import { createLogger } from '@open-scientist/logger'
import type { HypothesisPool, ScientificHypothesisPool } from '@open-scientist/schema'
import { join } from 'node:path'
import { type EmitChunk } from '../shared/stream.ts'
import { resolveAgentConfigArgs, runAgentWorkflow } from '../shared/run-workflow.ts'
import { createLibrarianAgent } from './agent.ts'

const logger = createLogger('agents')


export function buildLibrarianPrompt({
  seed,
  runId,
  datasetDir = getDatasetDir(),
  scientific = false,
}: {
  seed: string
  runId: string
  datasetDir?: string
  scientific?: boolean
}): string {
  if (scientific) {
    return `科学现象输入：${seed}

你正在执行日冕加热的科学现象闭环。所有自然语言字段必须使用中文。

先调用 loadSkill('solar-physics-rag')，再依次调用 searchPapers、
searchHypotheses、searchLocalSolarData 和 checkLocalSolarCoverage。
用户只提供自然语言现象；不得要求用户提供 sourceId、文件路径或固定表格。

候选假设必须由本轮现象和实际检索结果动态产生，数量为 2–4 条；不得套用
预写的阿尔芬波、磁重联或耦合模板。每条必须包含中文 statement、mechanism、
mechanismComposition、predictions、falsificationConditions、sourceIds、
parentId=null、round=1、status=candidate 和 createdAt。

文献来源只能写为 searchPapers 实际返回的 paper:<id>；本地来源只能使用
工具实际返回的 sourceId。历史假设只用于避免重复和寻找反例，不能当作新证据。
若贡献比例没有数据依据，mechanismComposition 中不得填写 contribution。

若必要检索未完成，或文献与本地观测均未返回可复核资料，提交 hypotheses=[]
和中文 rationale，并停止候选生成。不得编造论文、数值、诊断、反例或观测结论。
本地 AIA/HMI 覆盖仅代表可执行诊断范围；WCS、标定、物理派生指标、光谱或
MHD 产物缺失时，必须在 rationale 中明确说明。
不要因为 HelixDB 不可用而编造检索结果。最后必须调用 submit_result，提交
完整 HypothesisPool 和中文 rationale。运行标识：${runId}。`
  }

  return `种子问题：${seed}

所有自然语言输出必须使用中文。生成恰好 2 条机制多样的候选假设，并先使用
searchPapers 和 searchHypotheses 检索已有结果。每条假设必须包含 id、
statement、mechanism、predictions、falsificationConditions、sourceIds、
pythonCode、parentId=null、round=1、f1=null、status=candidate 和 createdAt。
pythonCode 必须是纯 Python filter(snapshot: dict) -> bool，并且只能使用
${join(datasetDir, 'dataset_manifest.json')} 中登记的 featureColumns；不得读取
targets.jsonl 或任何目标/标签字段。不得编造论文、DOI、来源、字段、观测值、
指标或反例。最后调用 submit_result，提交完整 HypothesisPool 和中文 rationale。
运行标识：${runId}。`
}


export interface LibrarianWorkflowInput {
  /** Seed hypothesis text from the user / Sisyphus. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createLibrarianAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /** Select the natural-language phenomenon path backed by the local observation pack. */
  scientific?: boolean
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour.
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback. The orchestrator
   * uses it to buffer chunks for SSE replay / reconnect.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`. When
   * the RunRegistry cancels a run, the abort propagates here to halt
   * in-flight LLM + tool calls.
   */
  abortSignal?: AbortSignal
}

/**
 * Librarian workflow: RAG retrieval → hypothesis pool generation.
 *
 * Round 1 of Tournament Evolution. Outputs a HypothesisPool (2 candidate
 * hypotheses, each with statement + pythonCode) and persists each hypothesis
 * to HelixDB + the local workspace via the agent's tools.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it (after conversion via `toUIMessageStream`).
 * The orchestrator (RunRegistry) buffers these for SSE replay / reconnect.
 */
export function librarianWorkflow(
  input: LibrarianWorkflowInput & { scientific: true },
): Promise<ScientificHypothesisPool>
export function librarianWorkflow(
  input: LibrarianWorkflowInput & { scientific?: false },
): Promise<HypothesisPool>
export async function librarianWorkflow(
  input: LibrarianWorkflowInput,
): Promise<HypothesisPool | ScientificHypothesisPool> {
  logger.info(
    { seed: input.seed, projectId: input.projectId, runId: input.runId },
    'librarian workflow start',
  )
    try {
      await ensureIndexes()
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'librarian workflow: Helix unavailable; continuing without index initialization',
      )
    }

  const prompt = buildLibrarianPrompt({
    seed: input.seed,
    runId: input.runId,
    scientific: input.scientific,
    datasetDir: getDatasetDir(),
  })

  const agent = await createLibrarianAgent({
    ...resolveAgentConfigArgs(input.modelConfig, input.agentConfig),
    projectId: input.projectId,
    runId: input.runId,
    runtimeContext: { projectId: input.projectId, runId: input.runId, round: 1 },
    allowEmptyHypothesisPool: Boolean(input.scientific),
  })
  const resolvedModelConfig = input.agentConfig?.modelConfig ?? input.modelConfig

  return runAgentWorkflow<HypothesisPool | ScientificHypothesisPool>({
    agent,
    projectId: input.projectId,
    runId: input.runId,
    role: 'librarian',
    stage: 'A',
    agentId: 'librarian',
    modelConfig: resolvedModelConfig,
    prompt,
    fallback: {
      hypotheses: [],
      rationale: 'Librarian 未在步数上限前调用 submit_result。',
    },
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
  })
}
