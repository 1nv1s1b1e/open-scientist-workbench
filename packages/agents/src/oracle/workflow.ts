import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'
import { type EmitChunk } from '../shared/stream.ts'
import { resolveAgentConfigArgs, runAgentWorkflow } from '../shared/run-workflow.ts'
import { createOracleAgent } from './agent.ts'

/**
 * Build the "Hypotheses + counterexamples" prompt block for the Oracle user
 * message. Each hypothesis is rendered with its id, round, status, F1 (pulled
 * from the matching EvalResult when available, else the hypothesis' own f1),
 * parentId, statement, pythonCode, and Explore counterexamples.
 *
 * Empty hypotheses list → empty string (the workflow substitutes a placeholder
 * in the surrounding message body).
 */
export function buildHypothesesBlock(hypotheses: Hypothesis[], evalResults: EvalResult[]): string {
  return hypotheses
    .map((h) => {
      const evalMatch = evalResults.find((e) => e.hypoId === h.id)
      const f1 = evalMatch?.f1 ?? h.f1
      const counterexamples = evalMatch?.counterexamples ?? []
      const counterexamplesBlock =
        counterexamples.length === 0
          ? '  (no counterexamples reported)'
          : counterexamples
              .map(
                (c) =>
                  `    - snapshotId=${c.snapshotId} | expected=${c.expected} | actual=${c.actual} | reason=${c.reason}`,
              )
              .join('\n')
      return `Hypothesis ${h.id} (round ${h.round}, status=${h.status}, f1=${f1 ?? 'n/a'}, parentId=${h.parentId ?? 'null'}):
  statement: ${h.statement}
  pythonCode:
\`\`\`python
${h.pythonCode}
\`\`\`
  counterexamples (${counterexamples.length}):
${counterexamplesBlock}`
    })
    .join('\n\n')
}

/**
 * Build the "Eval summary" prompt block: one line per EvalResult with its
 * hypoId, F1, TP/FP/FN counts, and execution time in ms.
 *
 * Empty evalResults → empty string (the workflow substitutes a placeholder).
 */
export function buildEvalSummaryBlock(evalResults: EvalResult[]): string {
  return evalResults
    .map(
      (e) =>
        `  - ${e.hypoId}: F1=${e.f1} TP=${e.truePositives} FP=${e.falsePositives} FN=${e.falseNegatives} (${e.executionMs}ms)`,
    )
    .join('\n')
}

export interface OracleWorkflowInput {
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Tournament round (1-based). Oracle consumes Explore's EvalResults from this round. */
  round: number
  /** Hypotheses under critique this round (each carries its latest f1 + status). */
  hypotheses: Hypothesis[]
  /** Explore evaluation results aligned 1:1 with hypotheses by hypoId. */
  evalResults: EvalResult[]
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createOracleAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour.
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Oracle workflow: Co-Scientist critique + mutation + elimination for one
 * tournament round.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it.
 */
export async function oracleWorkflow(input: OracleWorkflowInput): Promise<OracleOutput> {
  const agent = await createOracleAgent({
    ...resolveAgentConfigArgs(input.modelConfig, input.agentConfig),
    projectId: input.projectId,
    runId: input.runId,
    runtimeContext: { projectId: input.projectId, runId: input.runId, round: input.round },
  })

  const hypothesesBlock = buildHypothesesBlock(input.hypotheses, input.evalResults)
  const evalSummaryBlock = buildEvalSummaryBlock(input.evalResults)

  const prompt = `Oracle 第 ${input.round} 轮（runId=${input.runId}，projectId=${input.projectId}）。

以下是本轮评估的 ${input.hypotheses.length} 条假设，每条含 F1 分数和 Explore 反例。你的任务：批判每条假设，突变高潜力者，淘汰 fatal / 低 F1 者，仅在锦标赛明确收敛时命名赢家。

评估摘要：
${evalSummaryBlock || '  （尚无评估结果）'}

假设 + 反例：
${hypothesesBlock}

步骤：
1. 先加载 'critique-protocol' 和 'hypothesis-mutation' skill，获取五维评分标准、严重性映射、突变算子和反例调试流程。
2. 对每条假设：发出一条 Critique，severity（fatal/major/minor）基于具体 Explore 反例或物理守恒定律。用 getCritiquesByHypothesis 避免重复前序轮次的问题。
3. 用 addCritique 将每条批判持久化到 HelixDB（createdAt = now ISO 8601）。
4. 对高潜力父假设（major 批判但可修复）：按 4 种 AlphaEvolve 算子生成突变。每个 mutatedHypothesis 必须是完整 Hypothesis，含新 id、parentId = parentHypoId、round = ${input.round}、status = 'mutated'、与 statement 一致的 pythonCode。可用 bash/writeFile 在代表性快照上验证突变 filter。
5. 用 addMutationLink(parentHypoId, childHypoId, mutationType) 记录 MUTATED_FROM 边。避免回到已淘汰形式的环状突变（检查 parentId 链）。
6. 将本轮淘汰的假设 id 填入 eliminatedIds（fatal 批判或持续低 F1）。
7. 仅当本轮收敛时设置 winningHypoId 为获胜假设 id；否则留 null。

返回 OracleOutput（critiques[]、mutations[]、eliminatedIds[]、winningHypoId）。每条 major/fatal 批判必须配对一个突变或一次淘汰。`

  return runAgentWorkflow<OracleOutput>({
    agent,
    projectId: input.projectId,
    runId: input.runId,
    role: 'oracle',
    prompt,
    fallback: { critiques: [], mutations: [], eliminatedIds: [], winningHypoId: null },
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
  })
}
