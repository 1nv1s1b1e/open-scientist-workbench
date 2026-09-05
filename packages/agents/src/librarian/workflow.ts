import { getDatasetDir, type AgentRuntimeConfig, type ModelArg } from '@open-scientist/config'
import { ensureIndexes } from '@open-scientist/helix'
import { createLogger } from '@open-scientist/logger'
import type { HypothesisPool, ScientificHypothesisPool } from '@open-scientist/schema'
import { join } from 'node:path'
import { type EmitChunk } from '../shared/stream.ts'
import { resolveAgentConfigArgs, runAgentWorkflow } from '../shared/run-workflow.ts'
import { createLibrarianAgent } from './agent.ts'

const logger = createLogger('agents')

export function buildLibrarianPrompt({
  seed,
  runId,
  datasetDir = getDatasetDir(),
  scientific = false,
}: {
  seed: string
  runId: string
  datasetDir?: string
  scientific?: boolean
}): string {
  if (scientific) {
    return `科学现象输入：${seed}

你正在执行日冕加热的科学现象闭环。所有自然语言字段必须使用中文。

先调用 loadSkill('solar-physics-rag')，再至少三次调用 searchPapers，分别检索现象、候选机制区分预测和反例/否定结果；随后调用
searchHypotheses、searchLocalSolarData 和 checkLocalSolarCoverage。
用户只提供自然语言现象；不得要求用户提供 sourceId、文件路径或固定表格。

候选假设必须由本轮现象和实际检索结果动态产生，不按“本次只处理几个机制”分批；在上下文上限内一次提交所有有来源且在机制组成或可证伪预测上实质可区分的候选，不得为凑数重复改写，也不得套用
预写的阿尔芬波、磁重联或耦合模板。候选可包含不同单一机制及具有明确作用分工的
耦合机制，但必须在机制组合或可证伪预测上有实质差异，不得为凑数重复改写。每条必须包含中文 statement、mechanism、
mechanismComposition、predictions、falsificationConditions、sourceIds、
scope、parentId=null、round=1 和 status=candidate；不要添加 createdAt。
这是开放世界候选生成，不要求波动/重联/耦合三类必须出现，也不允许把这三类当作完整集合。若检索实际支持，应考虑热非平衡、近稳态基线、磁编织/电流片、压缩波或冲击、色球上流/针状体供质、磁通涌现/消失、动理学加热、传导—蒸发响应等替代解释；没有来源则不得硬加。rationale 必须列出“检索到的机制族、已形成候选的机制族、尚未形成合格候选的机制族”，并明确任何有限检索都不能声称穷尽全部物理可能性。

候选必须区分“热过程类别”和“具体能量释放机制”的证据层级：若现有数据只能
区分低频脉冲加热与近稳态加热，不得把候选直接写成“磁重联已主导”或“纳耀斑
已发生”。当检索资料与本地覆盖允许时，至少保留一条作用域受限的热过程类别候选，
其两条预测都应直接对应当前可执行的事件统计、冷却时延、DEM 或光谱诊断；具体
重联、波动或耦合候选仍作为更高机制层级的竞争解释。不得为了满足本条而捏造资料。
该受限候选的 mechanismComposition 必须明确表达“低频/间歇脉冲加热，具体能量释放机制未定”，
不得在同一 mechanism 中混入磁重联或纳耀斑，否则它已经越级为具体机制候选。
若 checkLocalSolarCoverage 返回 cohortReadiness.status=ready，至少生成一条与单事件候选分开的
“所选跨事件样本”热过程候选：scope 必须逐字说明它只适用于登记的 validation/holdout 样本。
两条原子预测必须严格使用 cohortReadiness.registeredPredictionPairing：第一条只写验证事件的
“94/131 热事件尾 + DEM 热响应”，不要在同一条中再加入冷却时延；第二条只写冻结光谱
留出事件的“IRIS Si IV 相对 Doppler 位移 + DEM 热响应”，不要把 Doppler 位移误写成线宽或展宽。
它只比较脉冲热过程与严格近稳态过程，不声称某个微观机制成立。
cohortReadiness 不是观测结果；只有后续确定性处理重新计算并通过证据门槛才能支持该候选。

searchPapers 会联合本地 Helix、已核验语料、OpenAlex 和 Crossref，并返回 provider/URL/缓存溯源。文献来源只能写为 searchPapers 实际返回的 paper:<id>；在线论文只能用于提出机制、预测和反例线索，不能当作本次 FITS 观测证据；本地来源只能使用
工具实际返回的 sourceId。历史假设只用于避免重复和寻找反例，不能当作新证据。
若贡献比例没有数据依据，mechanismComposition 中不得填写 contribution。

若必要检索未完成，或文献与本地观测均未返回可复核资料，提交 hypotheses=[]
和中文 rationale，并停止候选生成。不得编造论文、数值、诊断、反例或观测结论。
本地 AIA/HMI 覆盖仅代表可执行诊断范围；WCS、标定、物理派生指标、光谱或
MHD 产物缺失时，必须在 rationale 中明确说明。
checkLocalSolarCoverage 的 derivedDiagnostics 是当前处理状态的事实来源；当其
status=ready 时，不得再声称缺少 WCS 配准或 DEM。其 observable status 只能描述
观测条件，不能写成机制已经获得支持。
为避免 submit_result 被截断，每条 statement 不超过 100 个汉字，mechanism
不超过 180 个汉字，predictions 和 falsificationConditions 各写 2 条且每条不超过
80 个汉字，scope 不超过 120 个汉字；总 rationale 不超过 600 个汉字。
不要因为 HelixDB 不可用而编造检索结果。最后必须调用 submit_result，提交
完整 HypothesisPool 和中文 rationale。运行标识：${runId}。`
  }

  return `种子问题：${seed}

所有自然语言输出必须使用中文。生成恰好 2 条机制多样的候选假设，并先使用
searchPapers 和 searchHypotheses 检索已有结果。每条假设必须包含 id、
statement、mechanism、predictions、falsificationConditions、sourceIds、
pythonCode、parentId=null、round=1、f1=null、status=candidate 和 createdAt。
pythonCode 必须是纯 Python filter(snapshot: dict) -> bool，并且只能使用
${join(datasetDir, 'dataset_manifest.json')} 中登记的 featureColumns；不得读取
targets.jsonl 或任何目标/标签字段。不得编造论文、DOI、来源、字段、观测值、
指标或反例。最后调用 submit_result，提交完整 HypothesisPool 和中文 rationale。
运行标识：${runId}。`
}

export interface LibrarianWorkflowInput {
  /** Seed hypothesis text from the user / Oracle loop-coordination role. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createLibrarianAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /** Select the natural-language phenomenon path backed by the local observation pack. */
  scientific?: boolean
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour.
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback. The orchestrator
   * uses it to buffer chunks for SSE replay / reconnect.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`. When
   * the RunRegistry cancels a run, the abort propagates here to halt
   * in-flight LLM + tool calls.
   */
  abortSignal?: AbortSignal
}

/**
 * Librarian workflow: RAG retrieval → hypothesis pool generation.
 *
 * Round 1 of Tournament Evolution. Outputs a HypothesisPool (2 candidate
 * hypotheses, each with statement + pythonCode) and persists each hypothesis
 * to HelixDB + the local workspace via the agent's tools.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it (after conversion via `toUIMessageStream`).
 * The orchestrator (RunRegistry) buffers these for SSE replay / reconnect.
 */
export function librarianWorkflow(
  input: LibrarianWorkflowInput & { scientific: true },
): Promise<ScientificHypothesisPool>
export function librarianWorkflow(
  input: LibrarianWorkflowInput & { scientific?: false },
): Promise<HypothesisPool>
export async function librarianWorkflow(
  input: LibrarianWorkflowInput,
): Promise<HypothesisPool | ScientificHypothesisPool> {
  logger.info(
    { seed: input.seed, projectId: input.projectId, runId: input.runId },
    'librarian workflow start',
  )
  try {
    await ensureIndexes()
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'librarian workflow: Helix unavailable; continuing without index initialization',
    )
  }

  const prompt = buildLibrarianPrompt({
    seed: input.seed,
    runId: input.runId,
    scientific: input.scientific,
    datasetDir: getDatasetDir(),
  })

  const agent = await createLibrarianAgent({
    ...resolveAgentConfigArgs(input.modelConfig, input.agentConfig),
    projectId: input.projectId,
    runId: input.runId,
    runtimeContext: { projectId: input.projectId, runId: input.runId, round: 1 },
    allowEmptyHypothesisPool: Boolean(input.scientific),
  })
  const resolvedModelConfig = input.agentConfig?.modelConfig ?? input.modelConfig

  return runAgentWorkflow<HypothesisPool | ScientificHypothesisPool>({
    agent,
    projectId: input.projectId,
    runId: input.runId,
    role: 'librarian',
    stage: 'librarian',
    agentId: 'librarian',
    modelConfig: resolvedModelConfig,
    prompt,
    fallback: {
      hypotheses: [],
      rationale: 'Librarian 未在步数上限前调用 submit_result。',
    },
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
  })
}
