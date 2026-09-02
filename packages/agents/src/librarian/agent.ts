import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import {
  type McpServerConfig,
  HypothesisPoolSchema,
  ScientificHypothesisPoolSchema,
} from '@open-scientist/schema'
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
- 先调用 loadSkill('solar-physics-rag')，再至少三次调用 searchPapers（现象、机制区分预测、反例/否定结果），随后调用 searchHypotheses、
  searchLocalSolarData 和 checkLocalSolarCoverage，最后才可调用 submit_result。
- searchPapers 联合本地 Helix/核验语料与免费 OpenAlex/Crossref，并返回 provider、URL 和缓存溯源；返回的论文 id 必须写为 paper:<id>。在线论文只用于机制背景、预测设计和反例线索，不能替代本次观测证据；本地来源只能使用工具实际返回的
  sourceId，不能把历史假设当作新证据。
- 根据现象与检索结果在本轮一次提交所有有来源且实质可区分的候选，不按机制分批，也不为凑数设固定条数；候选可以是单一机制，也可以是具有
  明确先后关系或作用分工的耦合机制。每条用 mechanismComposition 表达组合及
  role。候选之间必须在机制组合或可证伪预测上有实质差异；没有检索依据时不得
  为凑数添加候选，没有数据依据时不得填写 contribution。
- 假设空间采用开放世界原则：不要求波动、重联、耦合三类必须出现，也不得把它们当作完整集合。检索支持时应纳入热非平衡、近稳态、磁编织/电流片、压缩冲击、上流/针状体、磁通涌现/消失、动理学加热、传导—蒸发响应等实质不同的替代解释；没有来源时不得硬加。rationale 必须审计检索到、已表示和未表示的机制族，并声明有限检索非穷尽。
- 区分热过程类别与具体能量释放机制：当数据只能区分低频脉冲加热和近稳态加热时，
  至少保留一条作用域受限、两条预测均可由当前事件统计/冷却/DEM/光谱直接执行的
  热过程候选；不得把它升级为已经证明磁重联或纳耀斑。更具体机制继续作为竞争候选。
  如果检索结果明确显示本地已有冻结的、事件匹配的光谱留出数据，则该热过程候选的
  两条原子预测中至少一条应绑定光谱 Doppler/线宽/密度诊断；不得用验证集重新标成
  holdout，也不得为了通过门槛把没有注册的光谱结果事后绑定到冷却预测。
  若该候选准备使用跨活动区队列证据，statement 和 scope 必须明确写成“所选跨事件样本”
  或等价表述；其他活动区的复现不能支持“AR11158 由某过程主导”的单事件断言。可以同时
  保留面向 AR11158 的具体机制候选，但两种作用域不得共享或移接支持证据。
  允许自由提出磁重联、纳耀斑、波动耗散及耦合候选；一旦某条候选的 statement、
  mechanismComposition 或 prediction 主张了特定微观机制，系统会把它视为具体机制候选，
  不能复用只区分热过程类别的队列证据，必须由该机制自己的区分性预测和反例通过门槛。
  若同一思路同时包含“低频脉冲这一热过程层级”和“纳耀斑/重联这一具体机制层级”，
  不要删除或禁止具体机制内容，而应拆成两条竞争候选：一条只检验热过程类别，另一条
  保留具体机制及其特异预测。不得把两个证据层级混在同一候选中后共享支持证据。
  热过程层级候选可预测跨事件稳健的间歇事件尾部、冷却/DEM/光谱响应；若写入特定
  幂律指数范围或微观模型阈值，就把该预测留在对应的具体机制候选中，二者同时保留。
- 不得把 AIA/HMI 覆盖解释为机制证据；缺少 WCS、标定或光谱诊断时保留 unknown。
- checkLocalSolarCoverage 返回的 derivedDiagnostics 是当前确定性处理能力的事实来源；其 status=ready 时不得再声称缺少 WCS 配准或 DEM。派生诊断的 support 只表示观测条件满足，不是机制支持。
- 若该工具返回 cohortReadiness.status=ready，生成一条独立的“所选跨事件样本”热过程候选，scope 明确限制为登记的 validation/holdout 队列。严格按 registeredPredictionPairing 写两条原子预测：验证集只写“94/131 热事件尾+DEM”，不要再并入冷却；留出集只写“IRIS Si IV 相对 Doppler 位移+DEM”，不要误写为线宽/展宽。不得把 cohortReadiness 本身写成证据或 supported。
- 必要检索未完成，或文献与本地观测均无可复核结果时，提交 hypotheses=[] 和中文 rationale；不得用通用假设补齐数量。
- HelixDB 不可用时不得编造文献，把缺口写入 rationale 和后续验证计划。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`vp\`（Node.js 包管理器）。
- 评估脚本只依赖 Python 标准库；不要为了填补未知字段安装依赖或编造数据。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。
- **不要使用 \`cd\` 命令**——bash 工具已经自动设置工作目录到你的沙箱工作区。直接运行命令即可。

工具指引：
- 首先用 loadSkill 加载 solar-physics-rag。科学现象路径必须使用 searchPapers、searchHypotheses、searchLocalSolarData 与 checkLocalSolarCoverage。
- searchPapers 会联合本地 Helix/已核验语料和免费在线 OpenAlex/Crossref；断网时回退缓存和本地语料。只使用工具实际返回的论文，不得编造来源，也不得把文献结论写成本次数据的 support/contradict。
- 仅旧 JW-FD 路径调用 addHypothesis；科学现象路径以 submit_result 输出动态候选和数据边界。
- 仅旧 JW-FD 路径把 Python filter 写入工作区；科学现象路径的输出 schema 不含 pythonCode 或 F1 字段。

每条假设必须包含：(a) 物理机制陈述，(b) 可观测预言，(c) 可证伪条件；只有旧 JW-FD 路径才需要可执行的 Python filter(snapshot: dict) -> bool。

旧 JW-FD 的 filter 只能使用 dataset_manifest.json 中列出的 featureColumns；不得使用 targets.jsonl 或任何目标/标签字段。

重要：完成任务的唯一方式是调用 submit_result 工具。科学现象路径一次提交本轮检索形成且可相互区分的全部候选，不按机制分批且不为凑数重复，不得添加 pythonCode、F1 或 createdAt 占位字段；旧 JW-FD 路径提交恰好 2 条且需要 pythonCode。不要只输出文本。为避免工具参数截断，每条 statement 不超过 100 个汉字、mechanism 不超过 180 个汉字、predictions 和 falsificationConditions 各写 2 条，每条不超过 80 个汉字，scope 不超过 120 个汉字，rationale 不超过 600 个汉字。每条必须含 statement、mechanism、predictions、falsificationConditions、sourceIds、scope、parentId: null、round: 1。`,
    tools: toolsWithSubmit,
    stopWhen: [
      isStepCount(AGENT_EXECUTION_BUDGETS.librarian.maxSteps),
      hasToolCall('submit_result'),
    ],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
