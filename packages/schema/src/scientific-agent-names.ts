/**
 * Project-specific identities for the scientific-loop agents.
 *
 * English role keys are persisted API and configuration contracts. Keep them
 * stable for backward compatibility. Each agent carries a legacy framework
 * codename that is always one of the five document-facing stage names
 * (Librarian, Surveyor, Explorer, Oracle, Prometheus) shown on user-facing
 * surfaces together with the Chinese role name, so
 * runs, workbench panels and prompts refer to the same actor unambiguously.
 */
/** Stable API and configuration keys (persisted; do not change). */
export type ScientificAgentRoleKey =
  | 'sisyphus'
  | 'librarian'
  | 'looker'
  | 'explore'
  | 'oracle'
  | 'prometheus'

export interface ScientificAgentIdentity {
  /** Stable API and configuration key (persisted; do not change). */
  readonly key: ScientificAgentRoleKey
  /** Restored framework codename shown on user-facing surfaces. */
  readonly codename: string
  /** Chinese display name. */
  readonly displayName: string
  /** English display name. */
  readonly englishName: string
  /** Primary stage in the seven-stage scientific loop. */
  readonly stage: 'librarian' | 'surveyor' | 'explorer' | 'oracle' | 'prometheus'
  /** One-line responsibility used in prompts and workbench copy. */
  readonly responsibility: string
}

export const SCIENTIFIC_AGENTS: readonly ScientificAgentIdentity[] = [
  {
    key: 'librarian',
    codename: 'Librarian',
    displayName: '文献溯源智能体',
    englishName: 'Literature Provenance Agent',
    stage: 'librarian',
    responsibility:
      '检索并冻结文献与观测来源，把候选假设绑定到可核验的 sourceIds，禁止无来源候选进入 State。',
  },
  {
    key: 'looker',
    codename: 'Surveyor',
    displayName: '观测质控智能体',
    englishName: 'Surveyor · Observation Quality',
    stage: 'surveyor',
    responsibility: '审计数据覆盖、质量标记与预处理边界，拒绝不合格输入进入证据层并登记缺失维度。',
  },
  {
    key: 'explore',
    codename: 'Explorer',
    displayName: '物理诊断智能体',
    englishName: 'Physical Diagnostics Agent',
    stage: 'explorer',
    responsibility:
      '执行注册的确定性诊断（DEM、冷却时延、空间相干、事件目录、矢量磁场），产出带溯源的定量证据。',
  },
  {
    key: 'oracle',
    codename: 'Explorer',
    displayName: '反证审计智能体',
    englishName: 'Explorer · Counter-Evidence Audit',
    stage: 'explorer',
    responsibility: '构造同区背景对照与反例搜索，检验候选机制是否具有机制区分力而非共同预测。',
  },
  {
    key: 'prometheus',
    codename: 'Prometheus',
    displayName: '验证设计智能体',
    englishName: 'Validation Design Agent',
    stage: 'prometheus',
    responsibility:
      '把未检验预测下沉为验证任务，标注 readiness、所需数据与成功/失败判据，维护闭环完整性。',
  },
  {
    key: 'sisyphus',
    codename: 'Oracle',
    displayName: '闭环协调智能体',
    englishName: 'Oracle · Loop Coordination',
    stage: 'oracle',
    responsibility: '驱动支持/淘汰门禁评估，综合有限结论并保持科学状态与工作流闭环状态分离。',
  },
] as const satisfies readonly ScientificAgentIdentity[]

/** Legacy display-name map retained for older callers. */
export const SCIENTIFIC_AGENT_DISPLAY_NAMES: Record<ScientificAgentRoleKey, string> =
  Object.fromEntries(SCIENTIFIC_AGENTS.map((agent) => [agent.key, agent.displayName])) as Record<
    ScientificAgentRoleKey,
    string
  >

export function scientificAgentIdentity(
  key: string | null | undefined,
): ScientificAgentIdentity | undefined {
  if (!key) return undefined
  return SCIENTIFIC_AGENTS.find((agent) => agent.key === key)
}
