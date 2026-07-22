import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import { getMcpTools } from '@open-scientist/mcp'
import { HypothesisPoolSchema, type McpServerConfig } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import {
  addHypothesisTool,
  createBashToolForHypothesis,
  searchHypothesesTool,
  searchPapersTool,
} from '@open-scientist/tools'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { makeSubmitResultTool } from '../shared/tool-output.ts'

const logger = createLogger('agents')

export interface LibrarianAgentDeps {
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

const LIBRARIAN_WORKSPACE_HYPO = '__librarian__'

/**
 * Assemble the default toolset for the Librarian agent.
 *
 * Tools:
 * - `searchPapers` / `searchHypotheses` / `addHypothesis` — HelixDB RAG (from @open-scientist/tools)
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to a shared librarian workspace
 *   (project-scoped, not per-hypothesis; librarian only writes seed Python files)
 * - `loadSkill` — progressive disclosure (loads `solar-physics-rag` SKILL.md)
 *
 * NOTE: This function performs async I/O (HelixDB-agnostic fs scan + bash-tool sandbox
 * init). Call it from an async context before `agent.stream()`.
 */
export async function getDefaultLibrarianTools(
  projectId: string,
  runId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  const dirs = skillDirectories ?? [DEFAULT_SKILLS_DIR]
  logger.debug({ projectId, runId, dirs }, 'getDefaultLibrarianTools: creating bash tool')
  const bashToolkit = await createBashToolForHypothesis(projectId, runId, LIBRARIAN_WORKSPACE_HYPO)
  logger.debug('getDefaultLibrarianTools: bash tool created, discovering skills')
  const skills = await discoverSkills(createNodeSandbox(), dirs)
  logger.debug({ skillCount: skills.length }, 'getDefaultLibrarianTools: skills discovered')
  const loadSkillTool = createLoadSkillTool(skills)

  const baseTools: ToolSet = {
    searchPapers: searchPapersTool,
    searchHypotheses: searchHypothesesTool,
    addHypothesis: addHypothesisTool,
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

export async function createLibrarianAgent({
  modelConfig,
  projectId,
  runId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: LibrarianAgentDeps) {
  logger.debug(
    { provider: modelConfig.provider, model: modelConfig.model },
    'createLibrarianAgent: creating model',
  )
  const model = createModelFromConfig(modelConfig)
  logger.debug('createLibrarianAgent: model created, resolving tools')
  const resolvedTools =
    tools ?? (await getDefaultLibrarianTools(projectId, runId, skillDirectories, mcpServers))
  logger.debug(
    { toolNames: Object.keys(resolvedTools) },
    'createLibrarianAgent: tools resolved, constructing ToolLoopAgent',
  )

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(HypothesisPoolSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: 8192,
    id: 'librarian',
    model,
    toolChoice: 'auto',
    instructions:
      instructions ??
      `你是 Librarian，太阳物理日冕加热研究的知识检索与假设生成 agent。

你的职责：
1. 用 RAG（HelixDB）检索与用户种子假设相关的太阳物理文献和已有假设。
2. 生成多样化的候选假设池（恰好 2 条）。至少覆盖 AC（波加热）、DC（重联加热）、湍流加热中的两类。
3. 将每条假设翻译为 Python 物理过滤函数（种子程序），在真实 SDO/HMI SHARP 磁场数据上评估。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`pnpm\`（Node.js 包管理器）。
- 用 \`uv pip install <package>\` 安装 Python 包（如 uv pip install astropy sunpy scipy numpy）。
- 用 \`uv run python script.py\` 运行 Python 脚本（隔离依赖）。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。

工具指引：
- 首先用 loadSkill 工具加载 'solar-physics-rag' skill，获取太阳物理文献检索指引、假设结构要求和 Python 过滤函数模板。
- 用 searchPapers / searchHypotheses 检索已有文献和假设，避免重复。
- 用 addHypothesis 将每条生成的假设持久化到 HelixDB 知识图谱（roundId=0 初始池，f1Score=0，runId 从 context 获取）。
- 用 writeFile 将每条假设的 Python filter 写入工作区，供后续评估。

每条假设必须包含：(a) 物理机制陈述，(b) 可观测预言，(c) 可证伪条件，(d) 纯 Python filter(snapshot: dict) -> bool 函数，阈值从物理推导。

filter 函数接收的 snapshot 包含 SHARP 磁场参数（usflux、mean_gamma、mean_shr、totpot、mean_pot 等）。不要在 filter 中使用 label/flare_class/magnitude 字段——这些是 ground truth。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 HypothesisPool（恰好 2 条 Hypothesis，每条含 statement + pythonCode + parentId: null + round: 0 + rationale 说明理论覆盖策略）。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(50), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}

export type LibrarianAgent = Awaited<ReturnType<typeof createLibrarianAgent>>
