import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { EvidenceAlignmentSchema, type McpServerConfig } from '@open-scientist/schema'
import { addEvidenceTool, fitsAlignTool, getEvidenceByHypothesisTool } from '@open-scientist/tools'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import { assembleDefaultTools } from '../shared/tool-assembly.ts'
import { makeSubmitResultTool } from '../shared/tool-output.ts'
import { AGENT_EXECUTION_BUDGETS, createSubmitResultPrepareStep } from '../shared/output-policy.ts'

export interface LookerAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name — drives workspace dir isolation + HelixDB scoping. */
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
   * serializable identifiers (projectId / runId / hypoId) for telemetry and
   * lineage. Must be plain data (no functions / class instances).
   */
  runtimeContext?: Record<string, unknown>
}

/**
 * Assemble the default toolset for the Multimodal Looker agent, bound to a
 * per-hypothesis workspace.
 *
 * Tools:
 * - `fitsAlign` — cross-modal spatiotemporal alignment (active region + timestamp
 *   + wavelength → FITS paths + video clip + metadata). Currently an informative
 *   stub that throws an install hint (astropy/sunpy not installed); the agent
 *   sees the schema and can surface the install instructions or fall back to bash.
 * - `getEvidenceByHypothesis` / `addEvidence` — HelixDB evidence read/write
 *   (retrieve prior evidence linked to the hypothesis; persist new evidence)
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to
 *   `data/projects/<project>/runs/<runId>/<hypoId>/` (project + hypothesis isolation,
 *   no sandbox — runs Python directly on host per AGENTS.md decision; used to
 *   query local FITS library or remote SDO data center via astropy/sunpy)
 * - `loadSkill` — progressive disclosure (loads `fits-snapshot-search` SKILL.md,
 *   which documents the SDO/AIA wavelength set + snapshot field structure that
 *   the Looker reuses for alignment keying)
 *
 * NOTE: This factory is async because `assembleDefaultTools` performs async I/O
 * (bash workspace dir creation + skills discovery). Call it before `agent.stream()`.
 *
 * Each hypothesis alignment gets a FRESH agent instance + FRESH bash workspace, so
 * parallel alignments (when wired in, the orchestrator would spawn N looker runs) don't share working dirs.
 */
export async function getDefaultLookerTools(
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
    extraTools: {
      fitsAlign: fitsAlignTool,
      getEvidenceByHypothesis: getEvidenceByHypothesisTool,
      addEvidence: addEvidenceTool,
    },
    skillDirectories,
    mcpServers,
  })
}

export async function createLookerAgent({
  modelConfig,
  projectId,
  runId,
  hypoId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: LookerAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const providerOptions = thinkingLevelToProviderOptions(
    modelConfig.provider,
    modelConfig.thinkingLevel,
  )
  const resolvedTools =
    tools ?? (await getDefaultLookerTools(projectId, runId, hypoId, skillDirectories, mcpServers))

  const toolsWithSubmit: ToolSet = {
    ...resolvedTools,
    submit_result: makeSubmitResultTool(EvidenceAlignmentSchema),
  }

  return new ToolLoopAgent({
    maxOutputTokens: AGENT_EXECUTION_BUDGETS.looker.maxOutputTokens,
    id: 'looker',
    model,
    providerOptions,
    toolChoice: 'auto',
    prepareStep: createSubmitResultPrepareStep(AGENT_EXECUTION_BUDGETS.looker.submitAtStep),
    instructions:
      instructions ??
      `你是 Multimodal Looker，太阳物理日冕加热研究的跨模态时空数据对齐 agent。

**所有输出（metadata 描述、alignment 说明等自然语言字段）必须用中文撰写。** 只有工具名、JSON key 保持英文。

你的职责：
1. 从 Explore 获取高分候选案例（活动区 + 时间戳 + 波长），针对某条假设。
2. 将候选案例匹配到原始 FITS 图像文件和 MP4 演化视频片段（时空索引对齐）。
3. 输出可核查的物理证据（FITS 路径 + 视频片段路径 + 对齐元数据），供人类审查，并持久化到 HelixDB 知识图谱。

多模态对齐物理指引（无单独 skill 文件——直接应用）：
- 活动区编号：NOAA AR 编号（如 AR1140、AR13078）。AR 编号是主空间键；与 FITS 头 SUNAR / AR_NUM 标签精确匹配。
- 时间戳：ISO 8601 UTC（如 2024-05-10T03:21:00Z）。FITS 观测时间在头 DATE-OBS。候选时间戳允许 ±12 分钟容差窗口（SDO/AIA 每通道 12s 采样，但对齐键取最近 12 分钟 synoptic 产品）。
- 波长：SDO/AIA EUV 通带——171Å、304Å、94Å、193Å、211Å、335Å、131Å。波长选择温度诊断：94Å≈6 MK（热/耀斑）、171Å≈0.8 MK（宁静日冕环）、304Å≈0.05 MK（过渡区/He II）、193Å≈1.2 MK、211Å≈2 MK、335Å≈2.5 MK、131Å≈10 MK（耀斑）。将 FITS 头 WAVELNTH（整数埃）匹配到候选波长。
- 空间索引：日面 Stonyhurst 坐标（LON, LAT）或日心直角坐标（HPC x,y 角秒）。从 FITS 头 CRPIX1/CRPIX2 + CDELT1/CDELT2 + CTYPE1/CTYPE2 推导。MP4 视频片段的空间索引是活动区 cutout 的边界框（xrange, yrange 角秒）。
- 对齐契约：FITS 图像和 MP4 视频片段必须覆盖相同的（AR、时间窗口、波长、空间边界框）。如果本地 FITS 库无匹配，回退到通过 sunpy 查询远程 SDO 数据中心（JSOC / VSO），然后缓存下载的文件路径。

环境：
- 本机已安装 \`uv\`（Python 包管理器）和 \`vp\`（Node.js 包管理器）。
- 用 \`uv pip install <package>\` 安装 Python 包（如 uv pip install astropy sunpy scipy numpy）。
- 用 \`uv run python script.py\` 运行 Python 脚本（隔离依赖）。
- 你的工作目录是沙箱工作区——所有文件操作（writeFile、readFile、bash）仅限此目录。不要尝试访问外部文件。
- **不要使用 \`cd\` 命令**——bash 工具已经自动设置工作目录到你的沙箱工作区。直接运行命令即可。

工具指引：
- 首先调用 \`fitsAlign\` 工具，传入 (hypoId, activeRegion, timestamp, wavelength)。返回 EvidenceAlignment（fitsPaths + videoClipPath + metadata）。注意：当前环境 fitsAlign 是一个信息性 stub，会抛出安装提示（astropy/sunpy 未安装）——发生时在日志中展示安装指引，回退到通过 \`bash\` 工具直接运行 astropy/sunpy（用 writeFile 写 Python 脚本，运行 \`python3 align.py\`，读取 stdout）。
- 先用 \`getEvidenceByHypothesis\` 检查该假设是否已有对齐证据（避免重复工作）。
- 对齐成功后，通过 \`addEvidence\` 持久化证据：hypoId、type='support'（若图像支持假设预言）或 'contradict'（若图像矛盾）、content（图像物理摘要）、f1Score（从 Explore 透传）、fitsPaths、videoPath、createdAt（ISO 8601 now）。
- 用 \`loadSkill\` 加载 'fits-snapshot-search' skill 获取 SDO/AIA 波长集 + 快照字段结构（复用为对齐键）。
- 用 \`writeFile\` 将对齐脚本 + FITS 路径清单持久化到工作区，供后续审计。

重要：完成任务的唯一方式是调用 submit_result 工具。你必须在步数上限之前调用它。不要只输出文本——始终调用 submit_result 提交你的 EvidenceAlignment（hypoId、fitsPaths[]、videoClipPath（无 MP4 时为 null）、metadata {activeRegion, timestamp, wavelength, spatialIndex}）。spatialIndex 必须是具体字符串如"HPC (-420..-280, -180..-40) arcsec"，不能是模糊标签。`,
    tools: toolsWithSubmit,
    stopWhen: [isStepCount(AGENT_EXECUTION_BUDGETS.looker.maxSteps), hasToolCall('submit_result')],
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}
