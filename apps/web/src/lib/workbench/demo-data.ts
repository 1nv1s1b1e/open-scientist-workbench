import type { PhenomenonInput } from '@open-scientist/schema'
import type { RoundUpdatePayload } from '@/lib/types/sse-events'
import type {
  MessageEdgeData,
  AgentRole,
  AgentState,
  OrchestratorData,
} from '@/lib/types/visualizers'
import type {
  ScientificWorkbenchState,
  ScientificOrchestrationState,
  WorkbenchEvidence,
  WorkbenchHypothesis,
  WorkbenchValidationTask,
} from './state'

/**
 * A visible, deterministic preview of the coronal-heating workflow.
 * It is intentionally labeled as a demo in the UI and never represents a live
 * observation or a completed scientific claim.
 */
export const DEMO_PHENOMENON: PhenomenonInput = {
  phenomenonId: 'demo-ar-13664-heating',
  title: '活动区出现不同步的多波段升温',
  description:
    '一个活动区在同一观测窗口内出现持续升温和局部亮度突增：EUV 响应先于软 X 射线增强，部分环状结构的温度上升并不同时发生。当前无法判断主要来自阿尔芬波耗散、磁重联纳耀斑，还是两者耦合。',
  activeRegion: 'AR 13664 · 演示场景',
  requestedQuestion: '哪一组观测最能区分两种机制，并判断它们是否存在耦合？',
  observations: [
    {
      sourceId: 'demo-aia-euv',
      kind: 'image',
      label: 'EUV 环状结构亮度序列（演示）',
      uri: 'demo://solar/aia-euv',
      instrument: 'SDO / AIA',
      wavelengthOrBand: '171 Å / 193 Å',
      observedAt: '演示观测窗口',
      activeRegion: 'AR 13664',
    },
    {
      sourceId: 'demo-goes-xray',
      kind: 'timeseries',
      label: '软 X 射线响应（演示）',
      uri: 'demo://solar/goes-xray',
      instrument: 'GOES',
      wavelengthOrBand: '1–8 Å',
      observedAt: '演示观测窗口',
      activeRegion: 'AR 13664',
    },
    {
      sourceId: 'demo-mhd-coupling',
      kind: 'simulation',
      label: '波动—重联耦合对照（演示）',
      uri: 'demo://solar/mhd-coupling',
      instrument: '局部 MHD',
      wavelengthOrBand: '数值派生量',
      observedAt: '演示参数组',
      activeRegion: 'AR 13664',
    },
  ],
  constraints: [
    '不能把单一波段的相关性直接写成加热机制已被证明。',
    '缺少可复核的处理溯源时，证据必须保留为 unknown。',
  ],
}

export const DEMO_HYPOTHESES: WorkbenchHypothesis[] = [
  {
    id: 'demo-h1-coupled-reconnection',
    statement: '磁重联纳耀斑提供主要能量释放，阿尔芬波耗散负责在环结构中重新分配热量。',
    mechanismComposition: [
      { mechanism: '磁重联纳耀斑', role: 'dominant', contribution: 0.58 },
      { mechanism: '阿尔芬波耗散', role: 'coupled', contribution: 0.42 },
    ],
    predictions: ['局部亮度突增先出现', '非热成分与温度响应具有短时关联', '沿环传播的热响应存在方向性'],
    falsificationConditions: ['没有局部能量释放时标', '温度变化不能在多波段中复现', '传播响应与波动模型不一致'],
    sourceIds: ['demo-aia-euv', 'demo-goes-xray', 'demo-mhd-coupling'],
    status: 'candidate',
    round: 2,
    confidence: 0.58,
  },
  {
    id: 'demo-h2-alfven-dominant',
    statement: '阿尔芬波耗散是主要加热通道，重联只在局部结构中提供次级触发。',
    mechanismComposition: [
      { mechanism: '阿尔芬波耗散', role: 'dominant', contribution: 0.68 },
      { mechanism: '磁重联纳耀斑', role: 'secondary', contribution: 0.32 },
    ],
    predictions: ['热响应沿磁力线传播', '功率谱中出现可识别的波动特征', '局部突发亮度不是必要条件'],
    falsificationConditions: ['热响应只在局部爆发后出现', '缺少波动传播或耗散的时空证据'],
    sourceIds: ['demo-aia-euv', 'demo-mhd-coupling'],
    status: 'uncertain',
    round: 2,
    confidence: 0.43,
  },
  {
    id: 'demo-h3-reconnection-only',
    statement: '观测到的升温主要由离散磁重联事件叠加产生，不需要持续的波动耗散。',
    mechanismComposition: [
      { mechanism: '磁重联纳耀斑', role: 'dominant', contribution: 0.9 },
      { mechanism: '阿尔芬波耗散', role: 'unknown', contribution: 0.1 },
    ],
    predictions: ['升温呈现离散脉冲', '亮度突增与磁拓扑变化同步', '波动功率不足以解释额外热量'],
    falsificationConditions: ['温度在无明显脉冲时仍持续上升', '观测到稳定的传播型热响应'],
    sourceIds: ['demo-aia-euv', 'demo-goes-xray'],
    status: 'revised',
    round: 1,
    confidence: 0.31,
  },
]

export const DEMO_EVIDENCE: WorkbenchEvidence[] = [
  {
    evidenceId: 'demo-e1-euv-lead',
    hypothesisId: 'demo-h1-coupled-reconnection',
    status: 'support',
    claim: 'EUV 亮度变化在软 X 射线响应之前出现，支持局部能量释放后再发生热量传输的可能性。',
    observed: 'EUV 与软 X 射线时间序列存在可比较的先后顺序。',
    method: '多波段时间对齐与峰值时差比较（演示）',
    sourceIds: ['demo-aia-euv', 'demo-goes-xray'],
    limitations: ['仅凭先后顺序不能区分重联和波动耗散。'],
    round: 1,
  },
  {
    evidenceId: 'demo-e2-propagating-response',
    hypothesisId: 'demo-h2-alfven-dominant',
    status: 'unknown',
    claim: '环状结构中存在沿磁力线传播的热响应，但目前没有完成速度和不确定度的确定。',
    observed: '演示输入包含空间上不同步的温度变化。',
    method: 'EUV 图像序列的时空追踪（待真实数据处理）',
    sourceIds: ['demo-aia-euv'],
    limitations: ['缺少确定的配准结果和可复核的样本 ID，不能升级为支持证据。'],
    round: 1,
  },
  {
    evidenceId: 'demo-e3-pulse-only',
    hypothesisId: 'demo-h3-reconnection-only',
    status: 'contradict',
    claim: '升温并非完全由孤立脉冲解释，部分结构在没有明显亮度突增时仍有温度变化。',
    observed: '演示案例中存在持续且不同步的升温段。',
    method: '脉冲事件与温度曲线的分段比较（演示）',
    sourceIds: ['demo-aia-euv', 'demo-goes-xray'],
    limitations: ['这里的反驳只用于展示闭环逻辑，不能替代真实样本统计。'],
    round: 2,
  },
  {
    evidenceId: 'demo-e4-mhd-signature',
    hypothesisId: 'demo-h1-coupled-reconnection',
    status: 'unknown',
    claim: '局部 MHD 对照中可以同时观察到波动耗散和重联耗散，但贡献比例尚未由真实参数扫描确定。',
    observed: '演示模拟包含两种机制的耦合分支。',
    method: 'MHD 能量项分解与观测量投影（待注册数据适配器）',
    sourceIds: ['demo-mhd-coupling'],
    limitations: ['当前只有演示占位，不能直接用于支持或反驳假设。'],
    round: 2,
  },
]

export const DEMO_VALIDATION_TASKS: WorkbenchValidationTask[] = [
  {
    taskId: 'demo-task-b-time-lag',
    route: 'B',
    status: 'planned',
    objective: '对齐 EUV 与软 X 射线时间序列，估计峰值时差及其置信区间。',
    triggeredBy: 'D · 区分局部释放与后续热传输',
    discriminatingOutcomes: ['稳定的 EUV 领先时差', '无统计显著时差', '不同活动区之间时差方向不一致'],
    round: 2,
  },
  {
    taskId: 'demo-task-b-wave-track',
    route: 'B',
    status: 'planned',
    objective: '在多波段图像序列中追踪沿环结构传播的亮度和温度扰动。',
    triggeredBy: 'D · 检验阿尔芬波耗散预测',
    discriminatingOutcomes: ['传播速度与波动模型一致', '只出现局部脉冲', '传播方向与磁拓扑不一致'],
    round: 2,
  },
  {
    taskId: 'demo-task-b-mhd-scan',
    route: 'B',
    status: 'planned',
    objective: '对波动耗散比例和纳耀斑释放频率做参数扫描，并投影到同一组观测量。',
    triggeredBy: 'D · 约束耦合机制的贡献范围',
    discriminatingOutcomes: ['只存在耦合参数区间', '单机制已足够解释', '模型与观测均无法匹配'],
    round: 2,
  },
  {
    taskId: 'demo-task-a-revise',
    route: 'A',
    status: 'planned',
    objective: '如果时差和传播证据相互冲突，重新拆分“主导机制”和“耦合贡献”的假设。',
    triggeredBy: 'D · 证据方向冲突时回到假设阶段',
    discriminatingOutcomes: ['保留耦合假设', '降低某一机制贡献', '提出新的机制组合'],
    round: 2,
  },
]

export const DEMO_ORCHESTRATION: ScientificOrchestrationState = {
  nodes: [
    { node: 'A.generate', state: 'completed', round: 1 },
    { node: 'A.verify', state: 'completed', round: 1 },
    { node: 'B.run', state: 'running', round: 2 },
    { node: 'BC.verify', state: 'idle', round: 2 },
    { node: 'C.synthesize', state: 'idle', round: 2 },
    { node: 'C.verify', state: 'idle', round: 2 },
    { node: 'D.plan', state: 'idle', round: 2 },
    { node: 'D.route', state: 'idle', round: 2 },
  ],
  agents: [
    { agentId: 'looker-source-audit', label: 'Looker：数据来源审计', state: 'running', round: 2, message: '核对观测数据的来源与可复核性' },
    { agentId: 'explorer-history-search', label: 'Explorer：历史资料与数据查找', state: 'completed', round: 2, message: '已找到可比较的历史活动区样本' },
    { agentId: 'explorer-observation-analysis', label: 'Explorer：多波段观测分析', state: 'queued', round: 2 },
    { agentId: 'oracle-counterexample-search', label: 'Oracle：反例与事实核验', state: 'queued', round: 2 },
    { agentId: 'oracle-fact-check', label: 'Oracle：事实性校正', state: 'queued', round: 2 },
  ],
  latestRoute: { round: 2, continue: true, reason: '当前证据仍不足，优先补充 B 阶段数据处理。', nextRoute: 'B' },
}

export const DEMO_SCIENTIFIC_STATE: ScientificWorkbenchState = {
  phenomenon: DEMO_PHENOMENON,
  inputDigest: 'demo-input-ar13664',
  round: 2,
  hypotheses: DEMO_HYPOTHESES,
  retrieval: null,
  evidence: DEMO_EVIDENCE,
  processingResults: [],
  validationTasks: DEMO_VALIDATION_TASKS,
  corrections: [
    {
      round: 2,
      stage: 'B → C',
      status: 'unknown',
      message: '传播响应缺少可复核的处理溯源，已保留为 unknown，并生成下一步数据任务。',
      unavailableSourceIds: ['demo-aia-euv'],
    },
  ],
  roundSummaries: [
    {
      round: 1,
      conclusion: '多波段升温顺序支持存在热量传输过程，但尚不足以区分波动耗散和磁重联。',
      evidenceSummary: { support: 1, contradict: 0, unknown: 1 },
    },
    {
      round: 2,
      conclusion: '当前更适合保留“重联主导、波动耦合”的候选假设；主导贡献仍需时差、传播和 MHD 参数扫描共同约束。',
      evidenceSummary: { support: 1, contradict: 1, unknown: 2 },
    },
  ],
  orchestration: DEMO_ORCHESTRATION,
  conclusion:
    '演示结论：现象同时包含局部突增和不同步的环结构响应，较适合用“磁重联主导、阿尔芬波耗散耦合”的候选组合继续检验。现有演示数据不能证明任何机制成立，下一步应优先完成多波段时差、传播追踪和 MHD 参数扫描。',
  terminationReason: 'demo_preview',
  status: 'completed',
}

export const DEMO_ROUND_UPDATE: RoundUpdatePayload = {
  type: 'custom',
  kind: 'tournament.round-update',
  round: 2,
  hypotheses: DEMO_HYPOTHESES.map((hypothesis, index) => ({
    id: hypothesis.id,
    statement: hypothesis.statement,
    mechanism: String(hypothesis.mechanismComposition?.[0]?.mechanism ?? '耦合机制'),
    predictions: hypothesis.predictions,
    falsificationConditions: hypothesis.falsificationConditions,
    sourceIds: hypothesis.sourceIds,
    parentId: index === 2 ? 'demo-h1-coupled-reconnection' : null,
    round: hypothesis.round ?? 1,
    f1: hypothesis.confidence ?? null,
    status: hypothesis.status,
    createdAt: 'demo',
  })),
  convergenceHistory: [
    { round: 1, bestF1: 0.46, count: 3 },
    { round: 2, bestF1: 0.58, count: 3 },
  ],
}

export const DEMO_AGENT_STATES: Partial<Record<AgentRole, AgentState>> = {
  sisyphus: 'thinking',
  librarian: 'thinking',
  looker: 'executing-tool',
  explore: 'executing-tool',
  oracle: 'idle',
  prometheus: 'idle',
}

export const DEMO_ORCHESTRATOR_EDGES: MessageEdgeData[] = [
  { source: 'sisyphus', target: 'librarian', kind: 'collab', active: true, label: '现象 → 假设池' },
  { source: 'librarian', target: 'looker', kind: 'new-hypothesis', active: true, label: '提出可观测预测' },
  { source: 'looker', target: 'explore', kind: 'collab', active: true, label: '多波段特征' },
  { source: 'explore', target: 'oracle', kind: 'critique', active: false, label: '证据与反例' },
  { source: 'oracle', target: 'prometheus', kind: 'new-hypothesis', active: false, label: '下一步验证' },
  { source: 'prometheus', target: 'sisyphus', kind: 'steering', active: false, label: '反馈到下一轮' },
]

export const DEMO_ORCHESTRATOR_DATA: OrchestratorData = {
  agents: [],
  edges: DEMO_ORCHESTRATOR_EDGES,
}

/** Convert the scientific state to the legacy visualizer's round contract. */
export function scientificStateToRoundUpdate(
  state: ScientificWorkbenchState,
): RoundUpdatePayload | null {
  if (state.hypotheses.length === 0) return null
  return {
    type: 'custom',
    kind: 'tournament.round-update',
    round: state.round,
    hypotheses: state.hypotheses.map((hypothesis, index) => ({
      id: hypothesis.id,
      statement: hypothesis.statement,
      mechanism: String(hypothesis.mechanismComposition?.[0]?.mechanism ?? '科学机制'),
      predictions: hypothesis.predictions,
      falsificationConditions: hypothesis.falsificationConditions,
      sourceIds: hypothesis.sourceIds,
      parentId: index === 0 ? null : hypothesis.id === state.hypotheses[2]?.id ? state.hypotheses[0]?.id ?? null : null,
      round: hypothesis.round ?? state.round,
      f1: hypothesis.confidence ?? null,
      status: hypothesis.status,
      createdAt: 'live',
    })),
    convergenceHistory: state.roundSummaries.map((summary) => ({
      round: summary.round,
      bestF1: summary.evidenceSummary?.support ?? 0,
      count: state.hypotheses.length,
    })),
  }
}
