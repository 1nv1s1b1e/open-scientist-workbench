import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { type McpServerConfig, PrometheusOutputSchema } from '@open-scientist/schema'
import { createMhdConfigTool } from '@open-scientist/tools'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { assembleDefaultTools } from '../shared/tool-assembly.ts'
import { makeSubmitResultTool } from '../shared/tool-output.ts'

export interface PrometheusAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name — drives shared prometheus workspace dir isolation. */
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

/**
 * Shared workspace slot for the Prometheus agent. Not per-hypothesis — Prometheus
 * runs once per round and writes MHD cfg / observation proposals into a common dir.
 */
const PROMETHEUS_WORKSPACE = 'prometheus'

/**
 * Assemble the default toolset for the Prometheus agent.
 *
 * Tools:
 * - `mhdConfig` — mhdConfigTool (from @open-scientist/tools): writes the MHD .cfg
 *   file under `data/projects/<projectId>/mhd/<runId>.cfg` + returns MhdConfig
 *   (cfgPath / proposalPath / summary). Called only on the final round.
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to a SHARED prometheus
 *   workspace (`data/projects/<projectId>/runs/<runId>/prometheus/`). No sandbox —
 *   runs on host per AGENTS.md decision. Shared across rounds of one run.
 * - `loadSkill` — progressive disclosure (loads `mhd-config-gen` SKILL.md)
 *
 * NOTE: This factory is async because `assembleDefaultTools` performs async I/O
 * (bash workspace dir creation + skills discovery). Call it before `agent.stream()`.
 * runtimeContext carries only serializable identifiers (projectId / runId / round).
 */
export async function getDefaultPrometheusTools(
  projectId: string,
  runId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  return assembleDefaultTools({
    projectId,
    runId,
    workspaceSlot: PROMETHEUS_WORKSPACE,
    extraTools: {
      mhdConfig: createMhdConfigTool(projectId),
    },
    skillDirectories,
    mcpServers,
  })
}

export async function createPrometheusAgent({
  modelConfig,
  projectId,
  runId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: PrometheusAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const providerOptions = thinkingLevelToProviderOptions(
    modelConfig.provider,
    modelConfig.thinkingLevel,
  )
  const resolvedTools =
    tools ?? (await getDefaultPrometheusTools(projectId, runId, skillDirectories, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(PrometheusOutputSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: 8192,
    id: 'prometheus',
    model,
    providerOptions,
    toolChoice: 'auto',
    instructions:
      instructions ??
      `你是 Prometheus，太阳物理日冕加热研究的多轮规划 agent（Scaling Test-time Compute）。

**所有输出（plan、observationProposal、rationale 等自然语言字段）必须用中文撰写。** 只有 MHD cfg 参数名、工具名、JSON key 保持英文。

你的职责：
1. 根据当前假设分数分布和用户（人在回路）物理直觉，动态调整下一轮突变搜索的物理参数范围。
2. 分配计算预算（maxEvals、parallelWorkers）。
3. 末轮收敛时：将获胜假设翻译为 MHD 模拟配置（.cfg）+ 卫星观测建议书。

用高 thinking level 进行战略规划。

环境：
- 本机已安装 \`uv\`（Python 包管理器）。
- 用 \`uv pip install <package>\` 安装 Python 包（如 uv pip install astropy sunpy scipy numpy）。
- 用 \`uv run python script.py\` 运行 Python 脚本（隔离依赖）。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。
- **不要使用 \`cd\` 命令**——bash 工具已经自动设置工作目录到你的沙箱工作区。直接运行命令即可。

工具指引：
- 加载 'mhd-config-gen' skill 获取 MHD 配置生成指引——在末轮（或收敛时）首先加载。skill 涵盖 .cfg 字段布局、从获胜 filter 阈值推导参数、观测建议书格式、推荐的卫星/仪器表（SDO/AIA、SDO/HMI、Hinode/XRT、IRIS、Parker Solar Probe、Solar Orbiter）。
- 仅在末轮调用 mhdConfig：传入 runId、winningHypoId、hypothesisStatement 和物理推导的 physicalParams 记录。工具会写 .cfg 文件并返回 MhdConfig 对象——原样嵌入你的输出。
- 用 bash / readFile / writeFile 做辅助计算（如推导无量纲数、校验参数量级与宁静太阳 ~300 W/m² 加热率是否合理）。
- 非末轮：不要调用 mhdConfig。输出 plan（含调整后的 searchParams + computeBudget），mhdConfig: null，shouldContinue: true。

收敛规则（设置 shouldContinue）：
- currentBestF1 >= 0.9 或 round >= 10 或 isFinalRound 标志为 true 时 shouldContinue = false。
- 否则 shouldContinue = true。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 PrometheusOutput { plan: PlanSchema, mhdConfig: MhdConfigSchema | null, shouldContinue: boolean }。

mhdConfig 工具会把观测建议书写入文件，返回 { cfgPath, proposalPath, summary } —— 你只需把这个返回值原样嵌入 submit_result 的 mhdConfig 字段即可，不要手动拼 observationProposal。

非末轮 mhdConfig 必须为 null；末轮 mhdConfig 必须非 null 且由 mhdConfig 工具产出。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(60), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
