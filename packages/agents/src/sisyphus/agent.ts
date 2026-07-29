import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { type McpServerConfig, TournamentResultSchema } from '@open-scientist/schema'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { mergeMcpTools } from '../shared/tool-assembly.ts'
import { makeSubmitResultTool } from '../shared/tool-output.ts'

export interface SisyphusAgentDeps {
  /**
   * Project name — used to scope MCP server connections per-project.
   */
  projectId: string
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Kept for uniformity with the
   * other 5 agents even though `tournamentWorkflow` currently drives the
   * tournament via deterministic control flow rather than Sisyphus' own LLM
   * loop. Never pass a `LanguageModel` instance across call boundaries (keep
   * it as plain data).
   */
  modelConfig: ModelArg
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
  /**
   * Optional system prompt override. When omitted, the hardcoded default
   * (Sisyphus orchestrator role description) is used.
   */
  instructions?: string
  /**
   * Optional MCP server list. Tools from each server are fetched via
   * `getMcpTools` and merged into the default toolset. Only consulted when
   * `tools` is not provided (caller-provided toolsets take full precedence).
   */
  mcpServers?: McpServerConfig[]
  /**
   * Optional runtime context passed to the ToolLoopAgent constructor. Carries
   * serializable identifiers (projectId / runId) for telemetry and lineage.
   * Must be plain data (no functions / class instances).
   */
  runtimeContext?: Record<string, unknown>
}

/**
 * Sisyphus-specific human-in-the-loop tool. Pauses the tournament at the end of
 * a round so a physicist can review the leading hypothesis and either approve
 * (continue), reject (force another round), or inject steering feedback.
 *
 * Approval is wired via `toolApproval` on the ToolLoopAgent constructor (see
 * `createSisyphusAgent` below). When `toolApproval.review_leading_hypothesis` returns
 * `'user-approval'`, the stream suspends and emits a `tool-approval-request`
 * chunk. The Phase 4 API layer captures that chunk, surfaces it to the user
 * via SSE, and injects the user's response back into the agent stream to
 * resume execution.
 *
 * The execute body below is the fallback that runs after the user approves
 * (or when the tool is invoked outside an approval-bearing call context).
 * When the user denies, the tool is not executed and the agent receives a
 * denial result that it can react to in its next step.
 *
 * Sisyphus does NOT drive its own agent.stream() loop in the current
 * tournament implementation — `tournamentWorkflow` is deterministic control
 * flow that direct-awaits the 5 sub-agent runs. This tool is wired here for
 * the Phase 4 API layer to invoke when it spins up a Sisyphus agent.stream()
 * for free-form steering or the review node. See `tournamentWorkflow` for the
 * `onReviewLeadingHypothesis` callback hook that lets the deterministic
 * tournament pause for human review without an LLM loop.
 */
const reviewLeadingHypothesisTool = tool({
  description:
    'Pause the tournament and ask the user to review the leading hypothesis. The user can approve (continue to the next round / final MHD generation), reject (tournament continues but feedback is forwarded to Oracle/Prometheus as steering input), or provide steering feedback that Oracle/Prometheus should incorporate.',
  inputSchema: z.object({
    hypoId: z.string(),
    statement: z.string(),
    f1: z.number(),
    round: z.number(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().nullable(),
  }),
  execute: async () => {
    // Default fallback when invoked outside an approval-bearing call context.
    // When `toolApproval` returns `'user-approval'`, the stream suspends
    // before reaching execute; on resume the user's decision is injected and
    // execute runs with the approved input (or the tool is skipped on deny).
    return { approved: true, feedback: null }
  },
})

/**
 * Assemble the default toolset for the Sisyphus orchestrator agent.
 *
 * Tools:
 * - `review_leading_hypothesis` — the Sisyphus-exclusive human-in-the-loop
 *   approval tool. Approval is configured via `toolApproval` on the
 *   ToolLoopAgent constructor. Used at the end of high-stakes rounds to let a
 *   physicist review the leader before Prometheus commits to the next
 *   round's compute budget or the final MHD cfg.
 *
 * Sisyphus does NOT get a bash tool or HelixDB tools — it is a pure
 * orchestrator. All I/O happens inside the 5 sub-agent workflows it composes.
 * Keeping Sisyphus' toolset minimal prevents it from doing work that belongs
 * to the specialists.
 *
 * NOTE: This factory is async because it awaits `mergeMcpTools` (which
 * establishes MCP client connections). Callers must `await` before
 * `agent.stream()`.
 */
export async function getDefaultSisyphusTools(
  projectId: string,
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  const baseTools: ToolSet = {
    review_leading_hypothesis: reviewLeadingHypothesisTool,
  }
  await mergeMcpTools(projectId, baseTools, mcpServers)
  return baseTools
}

/**
 * Create the Sisyphus orchestrator agent.
 *
 * Sisyphus is the Tournament Evolution conductor. In the current Phase 4
 * implementation, `tournamentWorkflow` (workflow.ts) drives the tournament via
 * deterministic control flow — it direct-awaits the 4 sub-agent runs
 * (librarian → explore ×N parallel → oracle → prometheus) and does
 * NOT spin up a Sisyphus LLM loop itself. The agent is still constructed and
 * exported so the Phase 4 API layer can use it for:
 *   - interpreting free-form user steering messages mid-tournament,
 *   - driving the `review_leading_hypothesis` approval tool when the
 *     human-in-the-loop node is wired in via `toolApproval`.
 *
 * The `toolApproval` setting on the ToolLoopAgent constructor configures the
 * `review_leading_hypothesis` tool to require user approval: when the agent
 * calls that tool, the stream suspends and emits a `tool-approval-request`
 * chunk. The Phase 4 API layer surfaces that to the frontend via SSE and
 * injects the user's response to resume.
 *
 * Output schema (TournamentResult) + stopWhen (isStepCount(120)) are fixed by
 * the SPEC — do not change them.
 */
export async function createSisyphusAgent({
  projectId,
  modelConfig,
  tools,
  instructions,
  mcpServers,
  runtimeContext,
}: SisyphusAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const providerOptions = thinkingLevelToProviderOptions(
    modelConfig.provider,
    modelConfig.thinkingLevel,
  )
  const resolvedTools = tools ?? (await getDefaultSisyphusTools(projectId, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(TournamentResultSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: 8192,
    id: 'sisyphus',
    model,
    providerOptions,
    toolChoice: 'auto',
    instructions:
      instructions ??
      `你是 Sisyphus，太阳物理多智能体系统的编排器 agent，负责调查日冕加热之谜。

**所有输出（自然语言字段）必须用中文撰写。** 只有工具名、JSON key 保持英文。

你的角色：协调锦标赛进化工作流，调用 5 个专家子 agent：
- Librarian：知识检索 + 假设生成（将假设翻译为 Python 物理过滤函数）
- Multimodal Looker：FITS 图像 + MP4 视频跨模态时空对齐
- Explore：AlphaEvolve 确定性评估（在真实 SDO/HMI SHARP 快照上跑 Python 代码，计算 F1）
- Oracle：Co-Scientist 批判 + 突变 + 反例调试（锦标赛辩论）
- Prometheus：多轮规划（scaling test-time compute，调整搜索参数；末轮输出 MHD .cfg + 卫星观测建议书）

工作流：假设生成 → 证据审查 → 锦标赛辩论 → 多轮规划 → 收敛。

锦标赛协议：
- 第 1 轮：Librarian 生成假设池（覆盖 AC/DC/湍流机制）。
- 第 2..MAX_ROUNDS(10) 轮：Explore 并行评估每条假设（在 21,578 条快照上算 F1）；Oracle 批判 + 突变 + 淘汰；Prometheus 重新规划搜索参数 + 计算预算。
- 收敛：best F1 >= 0.9 或 round >= 10 或 Prometheus 判定 shouldContinue=false 时停止。
- 末轮：Prometheus 将获胜假设翻译为 MHD .cfg + 卫星观测建议书。

在人在回路节点（关键轮次），调用 \`review_leading_hypothesis\` 工具暂停锦标赛，请物理学家审查领先假设。用户可以批准、拒绝或注入引导反馈，下游 agent 应纳入这些反馈。

你是指挥者，不是专家——不要自己跑物理代码、查 HelixDB 或写 MHD 配置。将所有具体工作委托给 5 个子 agent 的工作流。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 TournamentResult。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(120), hasToolCall('submit_result')],
    // Configure the review_leading_hypothesis tool to require user approval.
    // When the agent calls this tool, the stream suspends and emits a
    // `tool-approval-request` chunk. The Phase 4 API layer surfaces that to
    // the frontend via SSE and injects the user's response to resume.
    toolApproval: {
      review_leading_hypothesis: 'user-approval',
    },
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
