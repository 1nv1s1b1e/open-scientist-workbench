import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import { ensureIndexes } from '@open-scientist/helix'
import { createLogger } from '@open-scientist/logger'
import type { HypothesisPool } from '@open-scientist/schema'
import { persistAgentRun } from '../shared/persist.ts'
import { type EmitChunk, streamAgentOutput } from '../shared/stream.ts'
import { extractSubmitResult } from '../shared/tool-output.ts'
import { createLibrarianAgent } from './agent.ts'

const logger = createLogger('agents')

export type { TournamentInput, TournamentResult } from '@open-scientist/schema'

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
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour (backward compat).
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
 * Round 1 of Tournament Evolution. Outputs a HypothesisPool (3-6 candidate
 * hypotheses, each with statement + pythonCode) and persists each hypothesis
 * to HelixDB + the local workspace via the agent's tools.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it (after conversion via `toUIMessageStream`).
 * The orchestrator (RunRegistry) buffers these for SSE replay / reconnect.
 */
export async function librarianWorkflow(input: LibrarianWorkflowInput): Promise<HypothesisPool> {
  logger.info(
    { seed: input.seed, projectId: input.projectId, runId: input.runId },
    'librarian workflow start',
  )
  const agent = await createLibrarianAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    projectId: input.projectId,
    runId: input.runId,
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: 1,
    },
    ...(input.agentConfig?.instructions !== undefined
      ? { instructions: input.agentConfig.instructions }
      : {}),
    ...(input.agentConfig?.skillDirectories !== undefined
      ? { skillDirectories: input.agentConfig.skillDirectories }
      : {}),
    ...(input.agentConfig?.mcpServers !== undefined
      ? { mcpServers: input.agentConfig.mcpServers }
      : {}),
  })
  await ensureIndexes()
  logger.info('librarian workflow: starting agent.stream')

  const prompt = `种子假设：${input.seed}

为日冕加热之谜生成多样化的候选假设池。每条假设：
1. 陈述物理机制（AC/DC/湍流/组合），能量传输路径，耗散位置。
2. 给出可观测预言（哪些 SDO/AIA/HMI/IRIS 通带或磁场特征应出现）。
3. 给出可证伪条件（预言失效的场景）。
4. 写纯 Python filter(snapshot: dict) -> bool 函数，阈值从物理推导。

先加载 'solar-physics-rag' skill 获取检索指引和 Python filter 模板。用 searchPapers 和 searchHypotheses 检索已有文献和假设，避免重复。用 addHypothesis 将每条假设持久化到 HelixDB（roundId=0, f1Score=0, runId=${input.runId}, createdAt=now ISO 8601），用 writeFile 将 Python filter 写入工作区。

返回 HypothesisPool，rationale 说明覆盖策略。`

  const result = await agent.stream({
    messages: [{ role: 'user', content: prompt }],
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)
  await persistAgentRun(input.projectId, input.runId, 'librarian', prompt, result)
  const staticToolCalls = await result.staticToolCalls
  const fallback: HypothesisPool = {
    hypotheses: [],
    rationale: 'Librarian agent reached step limit without calling submit_result',
  }
  return extractSubmitResult(staticToolCalls, 'submit_result', fallback) as HypothesisPool
}
