import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { EvalResultSchema, type McpServerConfig } from '@open-scientist/schema'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { assembleDefaultTools } from '../../shared/tool-assembly.ts'
import { makeSubmitResultTool } from '../../shared/tool-output.ts'
import {
  AGENT_EXECUTION_BUDGETS,
  createSubmitResultPrepareStep,
} from '../../shared/output-policy.ts'

export interface ExploreAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name — drives workspace dir isolation. */
  projectId: string
  /** Run identifier — used for workspace dir isolation. */
  runId: string
  /** Hypothesis id — each hypothesis gets its own isolated bash workspace. */
  hypoId: string
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
   * serializable identifiers (projectId / runId / round / hypoId) for telemetry
   * and lineage. Must be plain data (no functions / class instances).
   */
  runtimeContext?: Record<string, unknown>
}

/**
 * Assemble the default toolset for the Explore agent, bound to a per-hypothesis workspace.
 *
 * Tools:
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to
 *   `data/projects/<project>/runs/<runId>/<hypoId>/` (project + hypothesis isolation,
 *   no sandbox — runs Python directly on host per AGENTS.md decision)
 * - `loadSkill` — progressive disclosure (loads `fits-snapshot-search` SKILL.md)
 *
 * NOTE: createBashToolForHypothesis is async (workspace dir creation), so this whole factory is async. Call
 * it before `agent.stream()`.
 *
 * Each hypothesis evaluation gets a FRESH agent instance + FRESH bash workspace, so
 * parallel evaluations (Sisyphus spawns N explore runs) don't share working dirs.
 */
export async function getDefaultExploreTools(
  projectId: string,
  runId: string,
  hypoId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  return assembleDefaultTools({
    projectId,
    runId,
    workspaceSlot: hypoId,
    skillDirectories,
    mcpServers,
  })
}

export async function createExploreAgent({
  modelConfig,
  projectId,
  runId,
  hypoId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: ExploreAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const providerOptions = thinkingLevelToProviderOptions(
    modelConfig.provider,
    modelConfig.thinkingLevel,
  )
  const resolvedTools =
    tools ?? (await getDefaultExploreTools(projectId, runId, hypoId, skillDirectories, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(EvalResultSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: AGENT_EXECUTION_BUDGETS.explore.maxOutputTokens,
    id: 'explore',
    model,
    providerOptions,
    toolChoice: 'auto',
    prepareStep: createSubmitResultPrepareStep(AGENT_EXECUTION_BUDGETS.explore.submitAtStep),
    instructions:
      instructions ??
      `你是 Explore，太阳物理日冕加热研究的 AlphaEvolve 式确定性评估 agent。

**所有输出（counterexamples 描述、logs、执行摘要等自然语言字段）必须用中文撰写。** 只有 pythonCode、工具名、JSON key 保持英文。

你的职责：
1. 接收候选假设的 Python 过滤函数（def filter(snapshot: dict) -> bool）。
2. 将其写入工作目录的 filter.py。
3. 运行 prompt 指定的共享评估脚本，在当前数据快照上计算 F1。
4. 读取输出，调试反例（FP/FN），修改 filter.py，重新运行——直到收敛或步数上限。
5. 输出 EvalResult（F1、TP/FP/FN、反例数组、manifest-backed candidateSnapshots、日志、执行时间）。candidateSnapshots 只能原样传递评估脚本给出的活动区、时间戳和波长，不能自行补全。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`vp\`（Node.js 包管理器）。
- 用 \`uv pip install <package>\` 安装 Python 包（如 uv pip install numpy scipy）。
- 用 \`uv run python script.py\` 运行 Python 脚本（隔离依赖）。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。
- **不要使用 \`cd\` 命令**——bash 工具已经自动设置工作目录到你的沙箱工作区。直接运行命令即可。

工具指引：
- 首先用 loadSkill 工具加载 'fits-snapshot-search' skill，获取数据集结构、评估契约和调试循环模式。
- 数据集目录、快照数量、目标列和特征列以 prompt 指定目录中的 \`dataset_manifest.json\` 为准。不要生成合成数据。
- 共享评估脚本位于 prompt 指定目录的 \`eval.py\`。不要自己写评估脚本；在 Windows/Linux 均使用：\`python <datasetDir>/eval.py filter.py\`。
- 你唯一的工作是写 \`filter.py\`（包含 \`filter(snapshot: dict) -> bool\` 函数），运行评估脚本，读取结果，迭代改进 filter。
- 评估脚本只依赖 Python 标准库；除非明确需要，不要安装额外依赖。
- filter 函数不能使用 label/flare_class/magnitude 字段——这些是 ground truth。
- 反例日志必须引用快照中实际存在的字段，不能杜撰物理属性；这些反馈给 Oracle 下一轮突变。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 EvalResult（hypoId、f1、truePositives、falsePositives、falseNegatives、counterexamples[]、candidateSnapshots[]、logs、executionMs）。不要修改确定性评估返回的数值、sample ID 或候选元数据。

步数预算管理：你有 120 步上限。建议：前 5 步加载 skill + 写 filter.py，接下来 10-20 步运行 eval + 调试，最后必须预留 1 步调用 submit_result。当你认为 filter 已经收敛或无法进一步改进时，立即调用 submit_result——不要继续迭代。即使 F1 不理想，也要提交当前最佳结果。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(AGENT_EXECUTION_BUDGETS.explore.maxSteps), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
