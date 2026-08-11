import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { type McpServerConfig, HypothesisPoolSchema, ScientificHypothesisPoolSchema } from '@open-scientist/schema'
import {
  addHypothesisTool,
  checkLocalSolarCoverageTool,
  searchHypothesesTool,
  searchLocalSolarDataTool,
  searchPapersTool,
} from '@open-scientist/tools'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { assembleDefaultTools } from '../shared/tool-assembly.ts'
import { makeSubmitResultTool } from '../shared/tool-output.ts'
import { AGENT_EXECUTION_BUDGETS, createSubmitResultPrepareStep } from '../shared/output-policy.ts'

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
  /** Scientific phenomenon runs may explicitly return an empty, bounded pool. */
  allowEmptyHypothesisPool?: boolean
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
 * NOTE: This function performs async I/O (skills fs scan + bash-tool workspace
 * init). Call it from an async context before `agent.stream()`.
 */
export async function getDefaultLibrarianTools(
  projectId: string,
  runId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  return assembleDefaultTools({
    projectId,
    runId,
    workspaceSlot: LIBRARIAN_WORKSPACE_HYPO,
    extraTools: {
      searchPapers: searchPapersTool,
      searchHypotheses: searchHypothesesTool,
      addHypothesis: addHypothesisTool,
      searchLocalSolarData: searchLocalSolarDataTool,
      checkLocalSolarCoverage: checkLocalSolarCoverageTool,
    },
    skillDirectories,
    mcpServers,
  })
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
  allowEmptyHypothesisPool = false,
}: LibrarianAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const providerOptions = thinkingLevelToProviderOptions(
    modelConfig.provider,
    modelConfig.thinkingLevel,
  )
  const resolvedTools =
    tools ?? (await getDefaultLibrarianTools(projectId, runId, skillDirectories, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(
      allowEmptyHypothesisPool ? ScientificHypothesisPoolSchema : HypothesisPoolSchema,
    ),
  }

  return new ToolLoopAgent({
    maxOutputTokens: AGENT_EXECUTION_BUDGETS.librarian.maxOutputTokens,
    id: 'librarian',
    model,
    providerOptions,
    toolChoice: 'auto',
    prepareStep: createSubmitResultPrepareStep(AGENT_EXECUTION_BUDGETS.librarian.submitAtStep),
    instructions:
      instructions ??
      `你是 Librarian，太阳物理日冕加热研究的知识检索与假设生成 agent。

**所有输出（statement、rationale、critiqueText、plan 等自然语言字段）必须用中文撰写。** 只有旧 JW-FD 路径的 pythonCode、工具名、JSON key 保持英文。

你的职责：
1. 用 RAG（HelixDB）检索与输入相关的太阳物理文献和已有假设。
2. 根据本轮输入和实际检索结果生成候选假设，不得套用固定机制模板。
3. 仅在旧版种子任务中生成 Python 物理过滤函数；科学现象路径不执行该代码。

当 prompt 表明为科学现象或本地观测包时：
- 先调用 loadSkill('solar-physics-rag')，再调用 searchPapers、searchHypotheses、
  searchLocalSolarData 和 checkLocalSolarCoverage，最后才可调用 submit_result。
- searchPapers 返回的论文 id 必须写为 paper:<id>；本地来源只能使用工具实际返回的
  sourceId，不能把历史假设当作新证据。
- 根据现象与检索结果动态提交 2–4 条候选；每条用 mechanismComposition 表达机制
  组合及 role。没有数据依据时不得填写 contribution。
- 不得把 AIA/HMI 覆盖解释为机制证据；缺少 WCS、标定或光谱诊断时保留 unknown。
- 必要检索未完成，或文献与本地观测均无可复核结果时，提交 hypotheses=[] 和中文 rationale；不得用通用假设补齐数量。
- HelixDB 不可用时不得编造文献，把缺口写入 rationale 和后续验证计划。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`vp\`（Node.js 包管理器）。
- 评估脚本只依赖 Python 标准库；不要为了填补未知字段安装依赖或编造数据。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。
- **不要使用 \`cd\` 命令**——bash 工具已经自动设置工作目录到你的沙箱工作区。直接运行命令即可。

工具指引：
- 首先用 loadSkill 加载 solar-physics-rag。科学现象路径必须使用 searchPapers、searchHypotheses、searchLocalSolarData 与 checkLocalSolarCoverage。
- searchPapers 在 Helix 暂不可达时会自动检索项目内已核验文献语料；只使用工具实际返回的论文，不得编造来源。
- 仅旧 JW-FD 路径调用 addHypothesis；科学现象路径以 submit_result 输出动态候选和数据边界。
- 仅旧 JW-FD 路径把 Python filter 写入工作区；科学现象路径的输出 schema 不含 pythonCode 或 F1 字段。

每条假设必须包含：(a) 物理机制陈述，(b) 可观测预言，(c) 可证伪条件；只有旧 JW-FD 路径才需要可执行的 Python filter(snapshot: dict) -> bool。

旧 JW-FD 的 filter 只能使用 dataset_manifest.json 中列出的 featureColumns；不得使用 targets.jsonl 或任何目标/标签字段。

重要：完成任务的唯一方式是调用 submit_result 工具。科学现象路径提交 2–4 条由本轮检索形成的候选，不得添加 pythonCode 或 F1 占位字段；旧 JW-FD 路径提交恰好 2 条且需要 pythonCode。不要只输出文本。每条必须含 statement、mechanism、predictions、falsificationConditions、sourceIds、parentId: null、round: 1，以及说明形成依据的 rationale。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(AGENT_EXECUTION_BUDGETS.librarian.maxSteps), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
