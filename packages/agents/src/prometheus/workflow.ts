import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { ConvergenceEntry, PrometheusOutput } from '@open-scientist/schema'
import { type EmitChunk } from '../shared/stream.ts'
import { resolveAgentConfigArgs, runAgentWorkflow } from '../shared/run-workflow.ts'
import { createPrometheusAgent } from './agent.ts'

export interface PrometheusWorkflowInput {
  /** Project name — drives shared prometheus workspace dir + MHD output dir. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Tournament round (1-based). Drives plan.round + the final-round gate. */
  round: number
  /** Per-round best F1 + surviving hypothesis counts, oldest → newest. */
  convergenceHistory: ConvergenceEntry[]
  /** Best F1 across the pool at the end of this round's Explore+Oracle pass. */
  currentBestF1: number
  /** true = final round (converged or MAX_ROUNDS); Prometheus MUST emit MHD cfg. */
  isFinalRound: boolean
  /** Winning hypothesis — only meaningful when isFinalRound is true. */
  winningHypothesis?: {
    hypoId: string
    statement: string
  }
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createPrometheusAgent` via `createModelFromConfig`.
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
   * Optional human-in-the-loop feedback forwarded from the
   * `onReviewLeadingHypothesis` callback in `tournamentWorkflow`. When
   * non-null, Prometheus incorporates this steering input into its plan
   * (e.g. "force another round", "consider alternative mechanism",
   * "the user suspects nanoflares are over-represented"). Forwarded only
   * on non-final rounds; ignored on the final round.
   */
  userFeedback?: string | null
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Prometheus workflow: multi-round planning + (final round) MHD cfg generation.
 *
 * Two modes driven by `isFinalRound`:
 *
 * 1. Non-final round — Prometheus reviews the convergence history (best F1 per
 *    round + surviving counts) and the current leader, then outputs an adjusted
 *    Plan for the next round. mhdConfig = null, shouldContinue = true (unless
 *    F1 >= 0.9 or round >= 10).
 *
 * 2. Final round — Prometheus loads the 'mhd-config-gen' skill, derives
 *    physical parameters from the winning hypothesis, calls the mhdConfig tool
 *    to write `data/projects/<projectId>/mhd/<runId>.cfg`, and embeds the
 *    returned MhdConfig. shouldContinue = false.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it.
 */
export async function prometheusWorkflow(
  input: PrometheusWorkflowInput,
): Promise<PrometheusOutput> {
  const agent = await createPrometheusAgent({
    ...resolveAgentConfigArgs(input.modelConfig, input.agentConfig),
    projectId: input.projectId,
    runId: input.runId,
    runtimeContext: { projectId: input.projectId, runId: input.runId, round: input.round },
  })

  const historyBlock =
    input.convergenceHistory.length > 0
      ? input.convergenceHistory
          .map(
            (e) =>
              `  - Round ${e.round}: bestF1=${e.bestF1.toFixed(4)}, survivingHypotheses=${e.count}`,
          )
          .join('\n')
      : '  (no prior rounds — this is the first planning call)'

  const prompt = input.isFinalRound
    ? `运行 ${input.runId} 已到达末轮（第 ${input.round} 轮）。收敛历史：
${historyBlock}
当前最佳 F1：${input.currentBestF1.toFixed(4)}

获胜假设：
  id: ${input.winningHypothesis?.hypoId ?? '<无>'}
  statement: ${input.winningHypothesis?.statement ?? '<无>'}

步骤：
1. 先加载 'mhd-config-gen' skill，获取 MHD .cfg 字段布局、从获胜 filter 阈值推导参数（加热率 vs 宁静太阳 ~300 W/m²、Lundquist number >> 1 快重联、plasma_beta ~ 0.01）、观测建议书格式 + 推荐卫星/仪器表。
2. 从获胜假设陈述推导 physicalParams 记录（plasma_beta、alfven_speed、reynolds_number、lundquist_number、heating_rate、magnetic_topology 等）。如需计算无量纲数可用 bash。
3. 调用 mhdConfig 工具，传入 runId=${input.runId}、winningHypoId、hypothesisStatement、physicalParams、observationProposal（完整观测建议书 markdown 文本）。工具会写 .cfg + _proposal.md 文件并返回 { cfgPath, proposalPath, summary }。
4. 输出 PrometheusOutput：plan（round=${input.round}，末轮 searchParams + computeBudget + rationale 总结锦标赛结果）、mhdConfig = 工具返回值（非 null）、shouldContinue = false。`
    : `运行 ${input.runId} 第 ${input.round} 轮规划。

收敛历史（每轮最佳 F1 + 存活假设数）：
${historyBlock}
当前最佳 F1：${input.currentBestF1.toFixed(4)}
${input.userFeedback ? `\n人类审稿反馈（来自 review_leading_hypothesis 节点）：\n  ${input.userFeedback}\n` : ''}
收敛规则：currentBestF1 >= 0.9 或 round >= 10 时 shouldContinue = false。否则 shouldContinue = true。

步骤：
1. 审视上述分数轨迹。如果 F1 在平台期，收窄 paramRange 并降低 mutationRate（开发）。如果 F1 仍在上升或方差大，扩宽 paramRange 并提高 mutationRate（探索）。如果存活数在坍缩，提高 populationSize。${input.userFeedback ? ' 将人类审稿反馈纳入计划——它可能覆盖默认的探索/开发启发式。' : ''}
2. 分配 computeBudget：在接近收敛的高价值轮次提高 maxEvals / parallelWorkers；在搜索明显停滞时缩减。
3. 输出 PrometheusOutput：plan（round=${input.round}，调整后的 searchParams.paramRange 为 name -> [min, max] 记录、populationSize、mutationRate、computeBudget { maxEvals, parallelWorkers }、rationale 说明探索/开发权衡${input.userFeedback ? ' + 审稿反馈如何纳入' : ''}）、mhdConfig = null、shouldContinue 按上述规则。`

  return runAgentWorkflow<PrometheusOutput>({
    agent,
    projectId: input.projectId,
    runId: input.runId,
    role: 'prometheus',
    prompt,
    fallback: {
      plan: {
        round: input.round,
        searchParams: { paramRange: {}, populationSize: 0, mutationRate: 0 },
        computeBudget: { maxEvals: 0, parallelWorkers: 0 },
        rationale: 'Prometheus agent reached step limit without calling submit_result',
      },
      mhdConfig: null,
      shouldContinue: false,
    },
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
  })
}
