'use client'

import {
  Activity,
  BookOpen,
  BrainCircuit,
  Check,
  ClipboardList,
  Database,
  FileCheck2,
  Layers3,
  ShieldAlert,
  ShieldCheck,
  SunMedium,
  TimerReset,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { EvidenceLedger } from './evidence-ledger'
import { ProcessingResults } from './processing-results'
import { ValidationQueue } from './validation-queue'
import { useWorkflowControls, type ExecutionMode } from '@/lib/chat/workflow-runtime'
import type { AgentRole, AgentState } from '@/lib/types/visualizers'
import type { ScientificWorkbenchState } from '@/lib/workbench/state'
import {
  evidenceCounts,
  scientificRounds,
  scientificRoundView,
} from '@/lib/workbench/scientific-rounds'
import { describeTerminationReason, formatCorrectionMessage } from '@/lib/workbench/workbench-copy'

type ResultSection = 'hypotheses' | 'processing' | 'evidence' | 'tasks' | 'boundary' | 'audit'

const RESULT_SECTIONS: Array<{ id: ResultSection; label: string; icon: typeof Layers3 }> = [
  { id: 'hypotheses', label: '竞争假设', icon: Layers3 },
  { id: 'processing', label: '数据处理', icon: Database },
  { id: 'evidence', label: '证据判读', icon: BookOpen },
  { id: 'tasks', label: '任务队列', icon: ClipboardList },
  { id: 'boundary', label: '结论边界', icon: ShieldCheck },
  { id: 'audit', label: '审计与校正', icon: ShieldAlert },
]

const AGENT_STEPS: Array<{
  key: 'A' | 'B' | 'C' | 'D'
  roles: AgentRole[]
  label: string
  color: string
}> = [
  { key: 'A', roles: ['librarian'], label: '形成假设', color: '#8ee8c2' },
  { key: 'B', roles: ['looker', 'explore', 'oracle'], label: '寻找证据', color: '#a0c3ec' },
  { key: 'C', roles: [], label: '整理结论', color: '#f6c77d' },
  { key: 'D', roles: ['prometheus'], label: '生成任务', color: '#c8a7ff' },
]

function statusText(status: string) {
  if (status === 'loading') return '正在恢复运行记录'
  if (status === 'streaming' || status === 'connecting' || status === 'running') return '分析进行中'
  if (status === 'reconnecting') return '正在恢复连接'
  if (status === 'blocked') return '已形成补充方案'
  if (status === 'error' || status === 'failed') return '本轮需要处理'
  if (status === 'done' || status === 'completed') return '本轮已完成'
  return '等待分析'
}

function hypothesisStatusLabel(status: string) {
  if (status === 'candidate') return '候选'
  if (status === 'supported') return '有指标支持'
  if (status === 'uncertain') return '待验证'
  if (status === 'revised') return '已修订'
  if (status === 'eliminated') return '已排除'
  return status || '待判断'
}

function stageState(
  step: (typeof AGENT_STEPS)[number],
  state: ScientificWorkbenchState,
  agentStates: Partial<Record<AgentRole, AgentState>>,
) {
  const active = step.roles.some(
    (role) => agentStates[role] === 'thinking' || agentStates[role] === 'executing-tool',
  )
  if (active) return 'active'
  if (step.key === 'A' && state.hypotheses.length > 0) return 'finished'
  if (step.key === 'B' && state.evidence.length > 0) return 'finished'
  if (step.key === 'C' && state.conclusion) return 'finished'
  if (step.key === 'D' && state.validationTasks.length > 0) return 'finished'
  return 'idle'
}

function StageRail({
  state,
  agentStates,
}: {
  state: ScientificWorkbenchState
  agentStates: Partial<Record<AgentRole, AgentState>>
}) {
  return (
    <div className="stage-rail" aria-label="分析进度">
      {AGENT_STEPS.map((step, index) => {
        const current = stageState(step, state, agentStates)
        const isLast = index === AGENT_STEPS.length - 1
        return (
          <div key={step.key} className="stage-item">
            <div
              className={`stage-node ${current === 'active' ? 'stage-node-active' : current === 'finished' ? 'stage-node-finished' : ''}`}
              style={{ '--stage-color': step.color } as React.CSSProperties}
            >
              {current === 'finished' ? <Check className="h-3.5 w-3.5" /> : <span>{step.key}</span>}
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-white">{step.label}</div>
              <div className="mt-0.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                {current === 'active' ? '进行中' : current === 'finished' ? '已产出' : '等待'}
              </div>
            </div>
            {!isLast && (
              <div
                className={`stage-connector ${current === 'active' || current === 'finished' ? 'stage-connector-active' : ''}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ScientificWorkbench({
  state,
  streamState,
  agentStates,
  runId,
  maxRounds,
  onMaxRoundsChange,
  executionMode,
  onExecutionModeChange,
}: {
  state: ScientificWorkbenchState
  streamState: string
  agentStates: Partial<Record<AgentRole, AgentState>>
  runId: string | null
  maxRounds: number
  onMaxRoundsChange: (value: number) => void
  executionMode: ExecutionMode
  onExecutionModeChange: (value: ExecutionMode) => void
}) {
  const [selectedHypothesisId, setSelectedHypothesisId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<ResultSection>('hypotheses')
  const [selectedResultRound, setSelectedResultRound] = useState<number | null>(null)

  const availableRounds = useMemo(() => scientificRounds(state), [state])
  const latestRound = availableRounds.at(-1) ?? Math.max(state.round, 1)
  const resultRound =
    selectedResultRound != null && availableRounds.includes(selectedResultRound)
      ? selectedResultRound
      : latestRound
  const roundView = useMemo(
    () => scientificRoundView(state, resultRound),
    [resultRound, state],
  )
  const roundEvidenceCounts = useMemo(() => evidenceCounts(roundView.evidence), [roundView.evidence])

  useEffect(() => {
    if (!selectedHypothesisId && state.hypotheses[0])
      setSelectedHypothesisId(state.hypotheses[0].id)
    if (
      selectedHypothesisId &&
      !state.hypotheses.some((item) => item.id === selectedHypothesisId)
    ) {
      setSelectedHypothesisId(state.hypotheses[0]?.id ?? null)
    }
  }, [selectedHypothesisId, state.hypotheses])

  useEffect(() => {
    if (selectedResultRound != null && !availableRounds.includes(selectedResultRound)) {
      setSelectedResultRound(null)
    }
  }, [availableRounds, selectedResultRound])

  const selectedHypothesis =
    state.hypotheses.find((item) => item.id === selectedHypothesisId) ?? state.hypotheses[0]
  const selectedEvidence = useMemo(
    () =>
      roundView.evidence.filter(
        (item) => !selectedHypothesis || item.hypothesisId === selectedHypothesis.id,
      ),
    [roundView.evidence, selectedHypothesis],
  )
  const effectiveStatus = state.status !== 'idle' ? state.status : streamState
  const workflow = useWorkflowControls()
  const isSubmitting =
    workflow?.isRunning ??
    ['connecting', 'running', 'streaming', 'reconnecting'].includes(effectiveStatus)
  const supportedCount = roundEvidenceCounts.support
  const contradictedCount = roundEvidenceCounts.contradict
  const pendingCount = roundEvidenceCounts.unknown
  const hasResults =
    state.hypotheses.length +
      state.processingResults.length +
      state.evidence.length +
      state.validationTasks.length >
      0 || Boolean(state.conclusion)
  const terminationLabel = describeTerminationReason(state.terminationReason)
  const hypothesisBlock = [...state.corrections]
    .reverse()
    .find((item) => item.stage === 'A' && (item.severity === 'error' || item.status === 'blocked'))
  return (
    <div className="workbench-shell">
      <div className="workbench-ambient workbench-ambient-one" />
      <div className="workbench-ambient workbench-ambient-two" />

      <header className="workbench-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <div className="sun-mark">
            <SunMedium className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="eyebrow-mono text-[var(--color-sunset-soft)]">活动区现象分析</div>
            <h1 className="truncate text-[1.45rem] font-semibold tracking-[-0.04em] text-white">
              科学工作台
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`status-chip ${effectiveStatus === 'blocked' ? 'status-chip-warning' : effectiveStatus === 'error' || effectiveStatus === 'failed' ? 'status-chip-danger' : ''}`}
          >
            <span
              className={`status-dot ${effectiveStatus === 'streaming' || effectiveStatus === 'running' ? 'status-dot-pulse' : ''}`}
            />
            {statusText(effectiveStatus)}
          </div>
          <label className="workbench-round-control hidden md:flex">
            <BrainCircuit className="h-3.5 w-3.5" />
            <span>执行方式</span>
            <select
              value={executionMode}
              disabled={isSubmitting}
              onChange={(event) => onExecutionModeChange(event.target.value as ExecutionMode)}
              aria-label="执行方式"
            >
              <option value="model-assisted" className="bg-[#101318]">
                真实模型
              </option>
              <option value="local-grounded" className="bg-[#101318]">
                本地复现
              </option>
            </select>
          </label>
          <label className="workbench-round-control hidden sm:flex">
            <TimerReset className="h-3.5 w-3.5" />
            <span>最大轮次</span>
            <select
              value={maxRounds}
              onChange={(event) => onMaxRoundsChange(Number(event.target.value))}
              aria-label="最大轮次"
            >
              {[1, 2, 3, 4, 5].map((round) => (
                <option key={round} value={round} className="bg-[#101318]">
                  {round}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="workbench-scroll">
        <section className="workbench-run-section">
          <aside className="workbench-run-card" aria-label="本轮分析状态">
            <div className="workbench-run-card-header">
              <div>
                <div className="eyebrow-mono text-cyan-200/70">本轮进度</div>
                <h2>分析正在留下什么</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="workbench-round-indicator">
                  第 {Math.max(state.round, 1)} / {maxRounds} 轮
                </span>
                <Activity className={`h-4 w-4 ${isSubmitting ? 'text-cyan-200' : 'text-white/35'}`} />
              </div>
            </div>
            <StageRail state={state} agentStates={agentStates} />
            <div className="workbench-run-facts">
              <div>
                <span>当前运行</span>
                <strong>{runId ? runId.slice(-8) : '尚未启动'}</strong>
              </div>
              <div>
                <span>候选解释</span>
                <strong>{state.hypotheses.length}</strong>
              </div>
              <div>
                <span>处理运行</span>
                <strong>{state.processingResults.length}</strong>
              </div>
              <div>
                <span>待执行任务</span>
                <strong>
                  {state.validationTasks.filter((item) => item.status === 'planned').length}
                </strong>
              </div>
            </div>
            <div className="workbench-retrieval" data-status={state.retrieval?.status ?? 'idle'}>
              <div className="workbench-retrieval-heading">
                <Database className="h-3.5 w-3.5" />
                <span>资料检索</span>
                <strong>
                  {state.retrieval ? `${state.retrieval.sourceCount} 个来源` : '尚未运行'}
                </strong>
              </div>
              <p>
                {state.retrieval?.message ??
                  '启动后将展示文献、历史假设、本地观测和覆盖核验的实际状态。'}
              </p>
              {state.retrieval && (
                <div className="workbench-retrieval-tools">
                  {state.retrieval.tools.map((tool) => (
                    <span key={tool.id} data-status={tool.status}>
                      {tool.label}
                      <b>{tool.resultCount}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>

        <section className="workbench-results-shell" aria-label="分析结果">
          <header className="workbench-results-header">
            <div>
              <div className="eyebrow-mono text-emerald-200/70">按轮次复核</div>
              <h2>第 {resultRound} 轮：假设如何经过处理、证据和任务继续推进</h2>
            </div>
            <div className="workbench-round-review">
              <div className="workbench-round-picker" aria-label="查看轮次">
                <select
                  value={resultRound}
                  onChange={(event) => setSelectedResultRound(Number(event.target.value))}
                >
                  {availableRounds.map((round) => (
                    <option key={round} value={round}>第 {round} 轮</option>
                  ))}
                </select>
              </div>
              <div className="workbench-result-counts">
                <span className="text-emerald-200/80">支持 {supportedCount}</span>
                <span className="text-rose-200/80">反例 {contradictedCount}</span>
                <span>证据不足 {pendingCount}</span>
              </div>
            </div>
          </header>
          <div className="workbench-result-tabs" role="tablist" aria-label="分析结果分类">
            {RESULT_SECTIONS.map((section) => {
              const Icon = section.icon
              const selected = activeSection === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveSection(section.id)}
                  className={
                    selected
                      ? 'workbench-result-tab workbench-result-tab-active'
                      : 'workbench-result-tab'
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
                </button>
              )
            })}
          </div>

          <div className="workbench-result-content" role="tabpanel">
            <AnimatePresence mode="wait" initial={false}>
              {activeSection === 'hypotheses' && (
                <motion.div
                  key="hypotheses"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  {state.hypotheses.length === 0 ? (
                    <div className="workbench-empty-result">
                      <Layers3 className="h-5 w-5" />
                        <p>{hypothesisBlock ? '本轮未生成可核验的竞争假设' : '尚未提出竞争假设'}</p>
                      <span>
                        {hypothesisBlock
                          ? formatCorrectionMessage(hypothesisBlock.message)
                          : '运行后只展示由本轮现象与实际检索资料形成的动态候选。'}
                      </span>
                      {hypothesisBlock?.action && (
                        <span className="workbench-empty-action">{hypothesisBlock.action}</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="workbench-hypothesis-list">
                        {state.hypotheses.map((hypothesis, index) => {
                          const active = selectedHypothesis?.id === hypothesis.id
                          const hypothesisEvidence = roundView.evidence.filter(
                            (item) => item.hypothesisId === hypothesis.id,
                          )
                          const hypothesisCounts = evidenceCounts(hypothesisEvidence)
                          return (
                            <button
                              type="button"
                              key={hypothesis.id}
                              aria-pressed={active}
                              onClick={() => setSelectedHypothesisId(hypothesis.id)}
                              className={`hypothesis-card text-left ${active ? 'hypothesis-card-active' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="hypothesis-index">假设 H{index + 1}</span>
                                <span
                                  className={`status-chip status-chip-small ${hypothesis.status === 'eliminated' ? 'status-chip-danger' : ''}`}
                                >
                                  {hypothesisStatusLabel(hypothesis.status)}
                                </span>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-white">
                                {hypothesis.statement}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {(hypothesis.mechanismComposition ?? [])
                                  .slice(0, 3)
                                  .map((item, itemIndex) => (
                                    <span key={`${hypothesis.id}-${itemIndex}`} className="mechanism-tag">
                                      {String(item.mechanism)}
                                      {typeof item.contribution === 'number'
                                        ? ` · ${Math.round(item.contribution * 100)}%`
                                        : ''}
                                    </span>
                                  ))}
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3 text-[12px] text-[var(--color-text-muted)]">
                                <span>第 {hypothesis.round ?? 1} 轮提出 · 第 {resultRound} 轮继续检验</span>
                                <span className="shrink-0 font-mono">
                                  {hypothesisEvidence.length} 证据 · {hypothesisCounts.support} 支持 ·{' '}
                                  {hypothesisCounts.contradict} 反例
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      {selectedHypothesis && (
                        <section className="hypothesis-followup">
                          <header>
                            <div>
                              <span>当前选中假设</span>
                              <strong>{selectedHypothesis.id}</strong>
                            </div>
                            <p>以下内容说明该假设如何进入第 {resultRound} 轮处理，不把共享处理运行误写成单一假设的专属实验。</p>
                          </header>
                          <div>
                            <article>
                              <span>可检验预测</span>
                              <ul>{(selectedHypothesis.predictions ?? []).slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                            </article>
                            <article>
                              <span>证伪条件</span>
                              <ul>{(selectedHypothesis.falsificationConditions ?? []).slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                            </article>
                            <article className="hypothesis-round-work">
                              <span>第 {resultRound} 轮实际工作</span>
                              <dl>
                                <div><dt>共享处理运行</dt><dd>{roundView.processingResults.length}</dd></div>
                                <div><dt>关联证据</dt><dd>{selectedEvidence.length}</dd></div>
                                <div><dt>本轮提出任务</dt><dd>{roundView.tasksProposed.length}</dd></div>
                              </dl>
                            </article>
                          </div>
                        </section>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {activeSection === 'evidence' && (
                <motion.div
                  key="evidence"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <EvidenceLedger evidence={selectedEvidence} round={resultRound} />
                </motion.div>
              )}
              {activeSection === 'tasks' && (
                <motion.div
                  key="tasks"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <ValidationQueue
                    tasks={state.validationTasks}
                    evidence={state.evidence}
                    round={resultRound}
                  />
                </motion.div>
              )}
              {activeSection === 'processing' && (
                <motion.div
                  key="processing"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <div className="processing-round-scope">
                    <div><span>本轮处理运行</span><strong>{roundView.processingResults.length}</strong></div>
                    <div><span>实际读取观测</span><strong>{roundView.processingResults.reduce((total, item) => total + item.usedObservationCount, 0)}</strong></div>
                    <div><span>登记处理产物</span><strong>{roundView.processingResults.length * 2}</strong></div>
                    <div><span>带确定性溯源的证据</span><strong>{roundEvidenceCounts.deterministic}</strong></div>
                    <p>处理数量按真实 processing run、读取观测和产物登记统计；模型审阅记录不会计作新的数据处理。</p>
                  </div>
                  <ProcessingResults results={roundView.processingResults} />
                </motion.div>
              )}
              {activeSection === 'boundary' && (
                <motion.div
                  key="boundary"
                  className="workbench-boundary-grid"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <article className="workbench-boundary-card workbench-boundary-conclusion">
                    <div className="flex items-center gap-2 text-xs text-[var(--color-body)]">
                      <FileCheck2 className="h-4 w-4 text-cyan-200" />
                      第 {resultRound} 轮判断
                    </div>
                    <p>
                      {roundView.summary?.conclusion ??
                        '尚未形成结论。系统会明确区分已经登记的证据、仍然未知的部分，以及下一步需要补充的资料。'}
                    </p>
                    {resultRound === latestRound && terminationLabel && <span>停止原因：{terminationLabel}</span>}
                  </article>
                  <article className="workbench-boundary-card">
                    <div className="flex items-center gap-2 text-xs text-[var(--color-body)]">
                      <ShieldCheck className="h-3.5 w-3.5 text-amber-200" />
                      结论强度边界
                    </div>
                    <dl className="boundary-evidence-counts">
                      <div><dt>支持性指标</dt><dd>{supportedCount}</dd></div>
                      <div><dt>反例 / 不一致</dt><dd>{contradictedCount}</dd></div>
                      <div><dt>不足以判定</dt><dd>{pendingCount}</dd></div>
                    </dl>
                    <p>这里仅展示经过校正后的本轮结论。事实核验、模型重试和过强推断的修正过程独立放在“审计与校正”，避免把过程日志混入科学结论。</p>
                  </article>
                </motion.div>
              )}
              {activeSection === 'audit' && (
                <motion.div
                  key="audit"
                  className="workbench-audit-panel"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <header>
                    <div>
                      <div className="eyebrow-mono text-amber-200/70">过程审计 / 第 {resultRound} 轮</div>
                      <h2>事实核验、自校正与模型重试</h2>
                    </div>
                    <span>{roundView.corrections.length} 条</span>
                  </header>
                  <p className="workbench-audit-explainer">这些记录说明系统如何拒绝无溯源证据、降级过强结论或重试不完整模型输出；它们影响结论，但本身不是科学证据。</p>
                  <div className="workbench-audit-list">
                    {roundView.corrections.map((correction, index) => (
                      <article
                        key={correction.correctionId ?? `legacy-correction-${resultRound}-${index}`}
                        className="workbench-correction"
                      >
                        <span>{correction.stage} 阶段 · {correction.kind ?? correction.severity ?? correction.status}</span>
                        <div>
                          {formatCorrectionMessage(correction.message)}
                          {correction.action && <small>修正动作：{correction.action}</small>}
                        </div>
                      </article>
                    ))}
                    {roundView.corrections.length === 0 && <p>本轮没有登记事实性校正。</p>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {!hasResults && state.status !== 'blocked' && (
          <div className="workbench-footer-note mb-8 mt-4 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
            <Database className="h-3.5 w-3.5" />
            尚未开始分析；填写现象后即可启动第一轮。
          </div>
        )}
        {state.status === 'blocked' ? (
          <div className="workbench-footer-note mb-8 mt-4 flex items-center gap-2 text-[12px] text-amber-200/70">
            <Database className="h-3.5 w-3.5" />
            本轮已保存资料检索结果，并生成可继续执行的补充任务。
          </div>
        ) : (
          hasResults && (
            <div className="workbench-footer-note mb-8 mt-4 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
              <Database className="h-3.5 w-3.5" />
              每条记录都会区分已完成的数据检查、机制证据和下一步验证任务。
            </div>
          )
        )}
      </div>
    </div>
  )
}
