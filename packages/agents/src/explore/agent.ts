import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { getMcpTools } from '@open-scientist/mcp'
import { EvalResultSchema, type McpServerConfig } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import { createBashToolForHypothesis } from '@open-scientist/tools'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { makeSubmitResultTool } from '../shared/tool-output.ts'

export interface ExploreAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name — drives workspace dir isolation. */
  project: string
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
 *   `data/projects/<project>/workspace/<hypoId>/` (project + hypothesis isolation,
 *   no sandbox — runs Python directly on host per AGENTS.md decision)
 * - `loadSkill` — progressive disclosure (loads `fits-snapshot-search` SKILL.md)
 *
 * NOTE: createBashTool is async (sandbox init), so this whole factory is async. Call
 * it before `agent.stream()`.
 *
 * Each hypothesis evaluation gets a FRESH agent instance + FRESH bash workspace, so
 * parallel evaluations (Sisyphus spawns N explore runs) don't share working dirs.
 */
export async function getDefaultExploreTools(
  project: string,
  runId: string,
  hypoId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  const dirs = skillDirectories ?? [DEFAULT_SKILLS_DIR]
  const bashToolkit = await createBashToolForHypothesis(project, runId, hypoId)
  const skills = await discoverSkills(createNodeSandbox(), dirs)
  const loadSkillTool = createLoadSkillTool(skills)

  const baseTools: ToolSet = {
    bash: bashToolkit.tools.bash,
    readFile: bashToolkit.tools.readFile,
    writeFile: bashToolkit.tools.writeFile,
    loadSkill: loadSkillTool,
  }
  if (mcpServers && mcpServers.length > 0) {
    for (const server of mcpServers) {
      const mcpTools = await getMcpTools(server)
      Object.assign(baseTools, mcpTools)
    }
  }
  return baseTools
}

export async function createExploreAgent({
  modelConfig,
  project,
  runId,
  hypoId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: ExploreAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const resolvedTools =
    tools ?? (await getDefaultExploreTools(project, runId, hypoId, skillDirectories, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(EvalResultSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: 8192,
    id: 'explore',
    model,
    toolChoice: 'auto',
    instructions:
      instructions ??
      `你是 Explore，太阳物理日冕加热研究的 AlphaEvolve 式确定性评估 agent。

你的职责：
1. 接收候选假设的 Python 过滤函数（def filter(snapshot: dict) -> bool）。
2. 将其写入工作目录的 filter.py。
3. 运行共享评估脚本，在真实 SDO/HMI SHARP 磁场数据（21,578 条快照）上计算 F1。
4. 读取输出，调试反例（FP/FN），修改 filter.py，重新运行——直到收敛或步数上限。
5. 输出 EvalResult（F1、TP/FP/FN、反例数组、日志、执行时间）。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`vp\`（Node.js 包管理器）。
- 用 \`uv pip install <package>\` 安装 Python 包（如 uv pip install numpy scipy）。
- 用 \`uv run python script.py\` 运行 Python 脚本（隔离依赖）。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。

工具指引：
- 首先用 loadSkill 工具加载 'fits-snapshot-search' skill，获取数据集结构、评估契约和调试循环模式。
- 数据集位于 \`data/dataset/snapshots.jsonl\`（21,578 条真实 SDO/HMI SHARP 快照）。不要生成合成数据——真实数据已就绪。
- 共享评估脚本位于 \`data/dataset/eval.py\`。不要自己写评估脚本。直接运行（绝对路径会通过 prompt 给出）：\`source <datasetDir>/.venv/bin/activate && python3 <datasetDir>/eval.py filter.py\`
- 你唯一的工作是写 \`filter.py\`（包含 \`filter(snapshot: dict) -> bool\` 函数），运行评估脚本，读取结果，迭代改进 filter。
- 共享 Python venv（含 numpy/scipy）已预装在 \`data/dataset/.venv\`。如需额外包：\`uv pip install --python <datasetDir>/.venv/bin/python <package>\`
- filter 函数不能使用 label/flare_class/magnitude 字段——这些是 ground truth。
- 反例日志必须物理具体（如"usflux 高但剪切角低，filter 未约束剪切角"），不能只是"预测错误"。这些反馈给 Oracle 下一轮突变。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 EvalResult（hypoId、f1、truePositives、falsePositives、falseNegatives、counterexamples[]、logs、executionMs）。

步数预算管理：你有 120 步上限。建议：前 5 步加载 skill + 写 filter.py，接下来 10-20 步运行 eval + 调试，最后必须预留 1 步调用 submit_result。当你认为 filter 已经收敛或无法进一步改进时，立即调用 submit_result——不要继续迭代。即使 F1 不理想，也要提交当前最佳结果。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(120), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}

export type ExploreAgent = Awaited<ReturnType<typeof createExploreAgent>>
