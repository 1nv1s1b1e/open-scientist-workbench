import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { type McpServerConfig, OracleOutputSchema } from '@open-scientist/schema'
import {
  addCritiqueTool,
  addMutationLinkTool,
  getCritiquesByHypothesisTool,
} from '@open-scientist/tools'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { assembleDefaultTools } from '../shared/tool-assembly.ts'
import { makeSubmitResultTool } from '../shared/tool-output.ts'
import { AGENT_EXECUTION_BUDGETS, createSubmitResultPrepareStep } from '../shared/output-policy.ts'

export interface OracleAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name (used for workspace isolation + HelixDB scoping). */
  projectId: string
  /** Run identifier — used for workspace dir isolation. */
  runId: string
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
  /** Optional system prompt override. When omitted, the hardcoded default is used. */
  instructions?: string
  /**
   * Optional skill discovery directories. When omitted, `DEFAULT_SKILLS_DIR`
   * from `@open-scientist/skills` is used. Only consulted when `tools` is
   * not provided.
   */
  skillDirectories?: string[]
  /**
   * Optional MCP server list. Tools from each server are fetched via
   * `getMcpTools` and merged into the default toolset. Only consulted when
   * `tools` is not provided.
   */
  mcpServers?: McpServerConfig[]
  /**
   * Optional runtime context passed to the ToolLoopAgent constructor. Carries
   * serializable identifiers (projectId / runId / round) for telemetry and
   * lineage. Must be plain data (no functions / class instances).
   */
  runtimeContext?: Record<string, unknown>
}

/** Shared workspace subdir for Oracle (not per-hypothesis). */
const ORACLE_WORKSPACE_HYPO = '__oracle__'

/**
 * Assemble the default toolset for the Oracle agent.
 *
 * Tools:
 * - `addCritique` / `addMutationLink` / `getCritiquesByHypothesis` — HelixDB write/read
 *   for persisting critiques + mutation edges to the knowledge graph
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to a shared oracle workspace
 *   at `data/projects/<projectId>/runs/<runId>/__oracle__/` (project-scoped, not per-
 *   hypothesis; Oracle only runs lightweight test scripts to validate mutations)
 * - `loadSkill` — progressive disclosure (loads `critique-protocol` + `hypothesis-mutation` skills)
 *
 * NOTE: This function performs async I/O (skills fs scan + bash-tool workspace init).
 * Call it from an async context before `agent.stream()`.
 */
export async function getDefaultOracleTools(
  projectId: string,
  runId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  return assembleDefaultTools({
    projectId,
    runId,
    workspaceSlot: ORACLE_WORKSPACE_HYPO,
    extraTools: {
      addCritique: addCritiqueTool,
      addMutationLink: addMutationLinkTool,
      getCritiquesByHypothesis: getCritiquesByHypothesisTool,
    },
    skillDirectories,
    mcpServers,
  })
}

export async function createOracleAgent({
  modelConfig,
  projectId,
  runId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: OracleAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const providerOptions = thinkingLevelToProviderOptions(
    modelConfig.provider,
    modelConfig.thinkingLevel,
  )
  const resolvedTools =
    tools ?? (await getDefaultOracleTools(projectId, runId, skillDirectories, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(OracleOutputSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: AGENT_EXECUTION_BUDGETS.oracle.maxOutputTokens,
    id: 'oracle',
    model,
    providerOptions,
    toolChoice: 'auto',
    prepareStep: createSubmitResultPrepareStep(AGENT_EXECUTION_BUDGETS.oracle.submitAtStep),
    instructions:
      instructions ??
      `你是 Oracle，太阳物理日冕加热研究的 Co-Scientist 评审与锦标赛辩论 agent。

**所有输出（critiqueText、rationale、mutationRationale、plan 等自然语言字段）必须用中文撰写。** 只有 pythonCode、工具名、JSON key 保持英文。

你的职责：
1. 批判每条已评估的假设（Co-Scientist 五维评分：物理合理性、观测一致性、可证伪性、理论完备性、新颖性）。
2. 突变高潜力假设（AlphaEvolve 式 4 算子：参数突变 / 结构突变 / 交叉 / 反例驱动）。
3. 淘汰低分假设（将 fatal / 低 F1 假设的 id 填入 eliminatedIds）。
4. 锦标赛收敛时可选命名赢家（winningHypoId），否则为 null。
5. 辩证调试反例——将 Explore 的反例按失败模式聚类，决定修复 vs. 结构突变 vs. 淘汰。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`vp\`（Node.js 包管理器）。
- 用 \`uv pip install <package>\` 安装 Python 包（如 uv pip install astropy sunpy scipy numpy）。
- 用 \`uv run python script.py\` 运行 Python 脚本（隔离依赖）。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。
- **不要使用 \`cd\` 命令**——bash 工具已经自动设置工作目录到你的沙箱工作区。直接运行命令即可。

工具指引：
- 首先加载 'critique-protocol' 和 'hypothesis-mutation' skill，获取五维评分标准、严重性映射（fatal/major/minor）、突变算子约束和辩证反例调试流程。
- 用 getCritiquesByHypothesis 读取该假设前序轮次的批判（避免重复已解决的问题）。
- 用 addCritique 将每条批判持久化到 HelixDB（createdAt = now ISO 8601）。
- 用 addMutationLink 记录父假设到子假设的 MUTATED_FROM 边（追踪进化链；检查 parentId 链避免回到已淘汰形式的环状突变）。
- 用 bash / writeFile 写轻量测试脚本，在提交突变前验证新 filter 在代表性快照上的行为。工作目录是 project 级的（\`__oracle__\` 子目录），一轮内所有批判共享——保持整洁。

输出契约（OracleOutputSchema）：
- critiques[]：每条已评估假设一条 Critique——{ hypoId, critiqueText（具体，如"在静态强剪切区失效"）, rationale（引用 Explore 反例或守恒定律）, severity（fatal/major/minor）, round }。
- mutations[]：零或多条高潜力父假设的突变——{ parentHypoId, mutatedHypothesis（完整 HypothesisSchema，含新 id + parentId + round + status 'mutated' + mechanism + predictions + falsificationConditions + sourceIds + 与 statement 一致的新 pythonCode）, mutationRationale（算子类型 + 改了什么 + 为什么，引用反例）, round }。除非通过真实检索获得新来源，否则保留可核查 sourceIds；不得用占位引用。
- eliminatedIds[]：本轮淘汰的假设 id（fatal 批判或低 F1）。
- winningHypoId：string | null——仅当本轮收敛时设置，否则 null。

每条 major/fatal 批判必须配对一个突变或一次淘汰。批判文本必须物理具体（指向具体参数/波段/失败模式），不能空泛（如"理论有缺陷"）。

锦标赛进化：你扮演严谨的科学审稿人。用高 thinking level 进行深度物理推理。不要编造 F1 数字——Oracle 只消费 Explore 的 EvalResults，不重新评估。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 OracleOutput。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(AGENT_EXECUTION_BUDGETS.oracle.maxSteps), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
