'use client'

import {
  ArrowLeft,
  BookOpenCheck,
  Database,
  GitBranch,
  ShieldCheck,
  SunMedium,
  Wrench,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ScientificWorkbenchState, WorkbenchHypothesis } from '@/lib/workbench/state'
import {
  evidenceCounts,
  scientificRounds,
  taskExecutionRound,
} from '@/lib/workbench/scientific-rounds'

type EvidenceCounts = ReturnType<typeof evidenceCounts>
type Verdict = 'support' | 'contradict' | 'unknown'

interface EvolutionNode extends EvidenceCounts {
  id: string
  hypothesis: WorkbenchHypothesis
  hypothesisIndex: number
  round: number
  x: number
  y: number
  verdict: Verdict
  action: string
  change: string
  evidence: ScientificWorkbenchState['evidence']
  executedTaskCount: number
}

interface EvolutionEdge {
  id: string
  hypothesisIndex: number
  path: string
}

interface RoundProcess {
  round: number
  y: number
  evidenceCount: number
  processingCount: number
  correctionCount: number
  executedTaskCount: number
  newHypothesisCount: number
  continuedHypothesisCount: number
  judgmentChangedCount: number
}

interface LineageDetailSelection {
  id: string
  round: number
  kind: 'snapshot' | 'evidence' | 'verdict' | 'processing' | 'correction' | 'task'
  title: string
  summary: string
  meta: string[]
}

function hypothesisX(index: number, total: number): number {
  if (total <= 1) return 500
  return 160 + index * (680 / (total - 1))
}

function compact(text: string, maximum = 34): string {
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text
}

function verdictFrom(counts: EvidenceCounts): Verdict {
  if (counts.contradict > 0) return 'contradict'
  if (counts.support > 0) return 'support'
  return 'unknown'
}

function verdictLabel(verdict: Verdict): string {
  if (verdict === 'support') return '支持'
  if (verdict === 'contradict') return '反例'
  return '证据不足'
}

function evolutionChange(current: EvidenceCounts, previous: EvidenceCounts | null): string {
  const total = current.support + current.contradict + current.unknown
  const currentVerdict = verdictFrom(current)
  if (!previous) return `首轮登记 ${total} 条证据 · ${verdictLabel(currentVerdict)}`
  const previousVerdict = verdictFrom(previous)
  if (currentVerdict !== previousVerdict)
    return `新增 ${total} 条证据 · ${verdictLabel(previousVerdict)} → ${verdictLabel(currentVerdict)}`
  return `新增 ${total} 条证据 · 保持${verdictLabel(currentVerdict)}`
}

function taskBelongsToHypothesis(
  task: ScientificWorkbenchState['validationTasks'][number],
  hypothesisEvidence: ScientificWorkbenchState['evidence'],
): boolean {
  const evidenceIds = new Set(hypothesisEvidence.map((item) => item.evidenceId))
  return (
    (task.triggeredBy ? evidenceIds.has(task.triggeredBy) : false) ||
    (task.resultEvidenceIds ?? []).some((id) => evidenceIds.has(id)) ||
    hypothesisEvidence.some((item) => item.taskId === task.taskId)
  )
}

function EvolutionRoundSelector({
  rounds,
  value,
  onChange,
}: {
  rounds: number[]
  value: number
  onChange: (round: number) => void
}) {
  return (
    <div className="evolution-round-selector" aria-label="切换演化轮次">
      <span>查看轮次</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {rounds.map((round) => (
          <option key={round} value={round}>
            第 {round} 轮
          </option>
        ))}
      </select>
    </div>
  )
}

function HypothesisLineageDetail({
  state,
  hypothesis,
  hypothesisIndex,
  rounds,
  playbackRound,
  onRoundChange,
  onBack,
  rootRef,
}: {
  state: ScientificWorkbenchState
  hypothesis: WorkbenchHypothesis
  hypothesisIndex: number
  rounds: number[]
  playbackRound: number
  onRoundChange: (round: number) => void
  onBack: () => void
  rootRef: RefObject<HTMLElement | null>
}) {
  const reduceMotion = useReducedMotion()
  const [selected, setSelected] = useState<LineageDetailSelection | null>(null)
  const visibleRounds = useMemo(
    () => rounds.filter((round) => round <= playbackRound),
    [playbackRound, rounds],
  )
  const hypothesisEvidence = useMemo(
    () => state.evidence.filter((item) => item.hypothesisId === hypothesis.id),
    [hypothesis.id, state.evidence],
  )
  const relatedTasks = useMemo(
    () => state.validationTasks.filter((task) => taskBelongsToHypothesis(task, hypothesisEvidence)),
    [hypothesisEvidence, state.validationTasks],
  )

  useEffect(() => {
    if (selected && selected.round > playbackRound) setSelected(null)
  }, [playbackRound, selected])

  const selectDetail = (value: LineageDetailSelection) => {
    setSelected((current) => (current?.id === value.id ? null : value))
  }

  return (
    <section
      ref={rootRef}
      className="evolution-shell evolution-detail-shell"
      aria-label={`H${hypothesisIndex + 1} 假说系谱`}
    >
      <header className="evolution-header evolution-detail-header">
        <div>
          <button type="button" className="lineage-back" onClick={onBack}>
            <ArrowLeft />
            返回假说总览
          </button>
          <div className="eyebrow-mono text-emerald-200/70">
            H{hypothesisIndex + 1} / HYPOTHESIS LINEAGE
          </div>
          <h1>H{hypothesisIndex + 1} 单假说系谱</h1>
          <p>{hypothesis.statement}</p>
        </div>
        <EvolutionRoundSelector rounds={rounds} value={playbackRound} onChange={onRoundChange} />
      </header>

      <div className={`lineage-detail-body ${selected ? 'has-selection' : ''}`}>
        <div className="lineage-detail-legend">
          <span>
            <i className="is-snapshot" />
            假说版本
          </span>
          <span>
            <i className="is-evidence" />
            证据记录
          </span>
          <span>
            <i className="is-verdict" />
            轮次判断
          </span>
          <span>
            <i className="is-operation" />
            处理 / 校正 / 任务
          </span>
        </div>

        <div className="lineage-round-stack">
          <AnimatePresence initial={false}>
            {visibleRounds.map((round, roundIndex) => {
              const evidence = hypothesisEvidence.filter((item) => item.round === round)
              const counts = evidenceCounts(evidence)
              const verdict = verdictFrom(counts)
              const previousRound = visibleRounds[roundIndex - 1]
              const previousCounts =
                previousRound == null
                  ? null
                  : evidenceCounts(
                      hypothesisEvidence.filter((item) => item.round === previousRound),
                    )
              const action =
                (hypothesis.round ?? 1) === round
                  ? '本轮提出假说'
                  : previousCounts && verdictFrom(previousCounts) !== verdict
                    ? '证据判断发生变化'
                    : '假说表述未变，继续检验'
              const processing = state.processingResults.filter((item) => item.round === round)
              const corrections = state.corrections.filter((item) => item.round === round)
              const tasks = relatedTasks.filter(
                (task) =>
                  task.round === round || taskExecutionRound(task, state.evidence) === round,
              )
              const snapshotId = `snapshot:${round}`
              const verdictId = `verdict:${round}`

              return (
                <motion.section
                  key={round}
                  className="lineage-round-section"
                  data-round={round}
                  initial={reduceMotion ? false : { opacity: 0, y: -18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: reduceMotion ? 0.01 : 0.34, ease: 'easeOut' }}
                >
                  <header>
                    <span>ROUND {round}</span>
                    <strong>{action}</strong>
                    <small>{evolutionChange(counts, previousCounts)}</small>
                  </header>

                  <button
                    type="button"
                    className={`lineage-detail-node lineage-snapshot-node ${selected?.id === snapshotId ? 'is-selected' : ''}`}
                    onClick={() =>
                      selectDetail({
                        id: snapshotId,
                        round,
                        kind: 'snapshot',
                        title: `H${hypothesisIndex + 1} · 第 ${round} 轮假说版本`,
                        summary: hypothesis.statement,
                        meta: [
                          action,
                          `提出于第 ${hypothesis.round ?? 1} 轮`,
                          (hypothesis.round ?? 1) === round
                            ? '本轮登记了该假说文本'
                            : '本轮没有登记新的假说文本版本',
                        ],
                      })
                    }
                  >
                    <span>H{hypothesisIndex + 1}</span>
                    <strong>第 {round} 轮版本</strong>
                    <small>{(hypothesis.round ?? 1) === round ? '新版本' : '沿用上一轮'}</small>
                  </button>

                  <div className="lineage-vertical-connector">
                    <i />
                  </div>
                  <div className="lineage-layer-title">
                    <BookOpenCheck />
                    本轮证据层 · {evidence.length} 条
                  </div>
                  <div className="lineage-fan lineage-evidence-fan">
                    {evidence.map((item, index) => {
                      const id = `evidence:${item.evidenceId}`
                      const status =
                        item.status === 'support'
                          ? 'support'
                          : item.status === 'contradict'
                            ? 'contradict'
                            : 'unknown'
                      return (
                        <button
                          key={item.evidenceId}
                          type="button"
                          className={`lineage-detail-node lineage-small-node is-${status} ${selected?.id === id ? 'is-selected' : ''}`}
                          onClick={() =>
                            selectDetail({
                              id,
                              round,
                              kind: 'evidence',
                              title: `E${index + 1} · ${status === 'support' ? '支持证据' : status === 'contradict' ? '反例证据' : '证据不足'}`,
                              summary: item.claim,
                              meta: [
                                item.observed ?? '未登记观测摘要',
                                `方法：${item.method ?? '未登记'}`,
                                `来源：${item.sourceIds?.length ?? 0} 个`,
                                item.provenance?.deterministic
                                  ? '具有确定性处理溯源'
                                  : '模型审阅或外部来源',
                              ],
                            })
                          }
                        >
                          <span>E{index + 1}</span>
                          <strong>
                            {status === 'support'
                              ? '支持'
                              : status === 'contradict'
                                ? '反例'
                                : '不足'}
                          </strong>
                          <small>{compact(item.claim, 18)}</small>
                        </button>
                      )
                    })}
                    {evidence.length === 0 && (
                      <div className="lineage-empty-node">本轮没有登记关联证据</div>
                    )}
                  </div>

                  <div className="lineage-merge-connector">
                    <i />
                  </div>
                  <button
                    type="button"
                    className={`lineage-detail-node lineage-verdict-node is-${verdict} ${selected?.id === verdictId ? 'is-selected' : ''}`}
                    onClick={() =>
                      selectDetail({
                        id: verdictId,
                        round,
                        kind: 'verdict',
                        title: `第 ${round} 轮判断 · ${verdictLabel(verdict)}`,
                        summary: evolutionChange(counts, previousCounts),
                        meta: [
                          `${counts.support} 支持`,
                          `${counts.contradict} 反例`,
                          `${counts.unknown} 证据不足`,
                          `${counts.deterministic} 条确定性溯源`,
                        ],
                      })
                    }
                  >
                    <span>
                      {verdict === 'support' ? 'S' : verdict === 'contradict' ? 'C' : '?'}
                    </span>
                    <strong>{verdictLabel(verdict)}</strong>
                    <small>
                      {counts.support}/{counts.contradict}/{counts.unknown}
                    </small>
                  </button>

                  <div className="lineage-vertical-connector">
                    <i />
                  </div>
                  <div className="lineage-layer-title">
                    <Wrench />
                    本轮操作层
                  </div>
                  <div className="lineage-fan lineage-operation-fan">
                    {processing.map((item, index) => {
                      const id = `processing:${item.processingRunId}`
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`lineage-detail-node lineage-small-node is-processing ${selected?.id === id ? 'is-selected' : ''}`}
                          onClick={() =>
                            selectDetail({
                              id,
                              round,
                              kind: 'processing',
                              title: `P${index + 1} · 共享确定性处理`,
                              summary: `${item.caseLabel}；读取 ${item.usedObservationCount} 条观测。`,
                              meta: [
                                `处理运行：${item.processingRunId}`,
                                `数据快照：${item.snapshotId}`,
                                `登记产物：${item.metricsArtifactId} / ${item.figureArtifactId}`,
                                '这是本轮共享处理，不声明为该假说专属实验',
                              ],
                            })
                          }
                        >
                          <span>P{index + 1}</span>
                          <strong>共享处理</strong>
                          <small>{item.usedObservationCount} 条观测</small>
                        </button>
                      )
                    })}
                    {corrections.length > 0 && (
                      <button
                        type="button"
                        className={`lineage-detail-node lineage-small-node is-correction ${selected?.id === `correction:${round}` ? 'is-selected' : ''}`}
                        onClick={() =>
                          selectDetail({
                            id: `correction:${round}`,
                            round,
                            kind: 'correction',
                            title: `C · 本轮共享校正 ${corrections.length} 条`,
                            summary: corrections
                              .slice(0, 3)
                              .map((item) => item.message ?? item.action ?? item.status)
                              .join('；'),
                            meta: [
                              '校正影响本轮结论边界，但本身不作为科学证据',
                              `${corrections.length} 条事实核验、重试或结论降级记录`,
                            ],
                          })
                        }
                      >
                        <span>C</span>
                        <strong>共享校正</strong>
                        <small>{corrections.length} 条</small>
                      </button>
                    )}
                    {tasks.map((task, index) => {
                      const id = `task:${round}:${task.taskId}`
                      const executionRound = taskExecutionRound(task, state.evidence)
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`lineage-detail-node lineage-small-node is-task ${selected?.id === id ? 'is-selected' : ''}`}
                          onClick={() =>
                            selectDetail({
                              id,
                              round,
                              kind: 'task',
                              title: `T${index + 1} · ${executionRound === round ? '本轮已执行' : '本轮提出任务'}`,
                              summary: task.objective,
                              meta: [
                                `执行器：${task.executorId ?? '未绑定'}`,
                                `状态：${task.status}`,
                                `路由：${task.route}`,
                                `结果证据：${task.resultEvidenceIds?.length ?? 0} 条`,
                              ],
                            })
                          }
                        >
                          <span>T{index + 1}</span>
                          <strong>{executionRound === round ? '已执行任务' : '验证任务'}</strong>
                          <small>{compact(task.objective, 18)}</small>
                        </button>
                      )
                    })}
                    {processing.length === 0 && corrections.length === 0 && tasks.length === 0 && (
                      <div className="lineage-empty-node">本轮没有关联处理、校正或任务</div>
                    )}
                  </div>

                  {round < playbackRound && (
                    <div className="lineage-next-round">
                      <i />
                      <span>证据与任务写回后进入下一轮</span>
                      <i />
                    </div>
                  )}
                </motion.section>
              )
            })}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {selected && (
            <motion.aside
              className="lineage-detail-inspector"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
            >
              <span>
                {selected.kind.toUpperCase()} · ROUND {selected.round}
              </span>
              <strong>{selected.title}</strong>
              <p>{selected.summary}</p>
              <ul>
                {selected.meta.map((item, index) => (
                  <li key={`${selected.id}-${index}`}>{item}</li>
                ))}
              </ul>
              <button type="button" aria-label="关闭节点详情" onClick={() => setSelected(null)}>
                <X />
              </button>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

export function EvolutionTree({ state }: { state: ScientificWorkbenchState }) {
  const rounds = useMemo(() => scientificRounds(state), [state])
  const latestRound = rounds.at(-1) ?? Math.max(state.round, 1)
  const [playbackRound, setPlaybackRound] = useState(latestRound)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [drillHypothesisId, setDrillHypothesisId] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(
    () => setPlaybackRound((current) => (rounds.includes(current) ? current : latestRound)),
    [latestRound, rounds],
  )

  const visibleRounds = useMemo(
    () => rounds.filter((round) => round <= playbackRound),
    [playbackRound, rounds],
  )
  const canvasHeight = 370 + Math.max(visibleRounds.length - 1, 0) * 255

  const tree = useMemo(() => {
    const nodes: EvolutionNode[] = []
    const edges: EvolutionEdge[] = []
    const processes: RoundProcess[] = []

    visibleRounds.forEach((round, roundIndex) => {
      const y = 245 + roundIndex * 255
      const previousRound = visibleRounds[roundIndex - 1]
      const roundEvidence = state.evidence.filter((item) => item.round === round)
      const availableHypotheses = state.hypotheses.filter((item) => (item.round ?? 1) <= round)
      const newHypotheses = availableHypotheses.filter((item) => (item.round ?? 1) === round)
      const continuedHypotheses = availableHypotheses.filter((item) => (item.round ?? 1) < round)
      const judgmentChangedCount =
        previousRound == null
          ? 0
          : continuedHypotheses.filter((hypothesis) => {
              const previous = evidenceCounts(
                state.evidence.filter(
                  (item) => item.round === previousRound && item.hypothesisId === hypothesis.id,
                ),
              )
              const current = evidenceCounts(
                roundEvidence.filter((item) => item.hypothesisId === hypothesis.id),
              )
              return verdictFrom(previous) !== verdictFrom(current)
            }).length

      processes.push({
        round,
        y: 128 + roundIndex * 255,
        evidenceCount: roundEvidence.length,
        processingCount: state.processingResults.filter((item) => item.round === round).length,
        correctionCount: state.corrections.filter((item) => item.round === round).length,
        executedTaskCount: state.validationTasks.filter(
          (task) => taskExecutionRound(task, state.evidence) === round,
        ).length,
        newHypothesisCount: newHypotheses.length,
        continuedHypothesisCount: continuedHypotheses.length,
        judgmentChangedCount,
      })

      availableHypotheses.forEach((hypothesis) => {
        const hypothesisIndex = state.hypotheses.findIndex((item) => item.id === hypothesis.id)
        const x = hypothesisX(hypothesisIndex, state.hypotheses.length)
        const evidence = roundEvidence.filter((item) => item.hypothesisId === hypothesis.id)
        const counts = evidenceCounts(evidence)
        const previousCounts =
          previousRound == null
            ? null
            : evidenceCounts(
                state.evidence.filter(
                  (item) => item.round === previousRound && item.hypothesisId === hypothesis.id,
                ),
              )
        const currentVerdict = verdictFrom(counts)
        const previousVerdict = previousCounts ? verdictFrom(previousCounts) : null
        const introducedNow = (hypothesis.round ?? 1) === round
        const hypothesisEvidence = state.evidence.filter(
          (item) => item.hypothesisId === hypothesis.id,
        )
        const executedTaskCount = state.validationTasks.filter(
          (task) =>
            taskBelongsToHypothesis(task, hypothesisEvidence) &&
            taskExecutionRound(task, state.evidence) === round,
        ).length

        nodes.push({
          id: `${round}:${hypothesis.id}`,
          hypothesis,
          hypothesisIndex,
          round,
          x,
          y,
          verdict: currentVerdict,
          action: introducedNow
            ? '本轮提出假说'
            : previousVerdict !== currentVerdict
              ? '证据判断发生变化'
              : '表述未变，继续检验',
          change: evolutionChange(counts, previousCounts),
          evidence,
          executedTaskCount,
          ...counts,
        })

        if (roundIndex === 0 || introducedNow) {
          edges.push({
            id: `root:${round}:${hypothesis.id}`,
            hypothesisIndex,
            path: `M 500 82 C 500 112, ${x} 126, ${x} ${y - 28}`,
          })
        } else {
          const previousY = y - 255
          edges.push({
            id: `${round}:${hypothesis.id}`,
            hypothesisIndex,
            path: `M ${x} ${previousY + 28} C ${x} ${previousY + 84}, ${x} ${y - 86}, ${x} ${y - 28}`,
          })
        }
      })
    })
    return { nodes, edges, processes }
  }, [state, visibleRounds])

  useEffect(() => {
    if (drillHypothesisId && !state.hypotheses.some((item) => item.id === drillHypothesisId))
      setDrillHypothesisId(null)
  }, [drillHypothesisId, state.hypotheses])

  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'start' })
  }, [drillHypothesisId])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const centerTreeOnNarrowViewport = () => {
      if (
        viewport.clientWidth < 720 &&
        viewport.scrollWidth > viewport.clientWidth &&
        viewport.scrollLeft === 0
      ) {
        const canvas = viewport.firstElementChild as HTMLElement | null
        viewport.scrollLeft = Math.max(
          0,
          ((canvas?.clientWidth ?? viewport.scrollWidth) - viewport.clientWidth) / 2,
        )
      }
    }
    const observer = new ResizeObserver(centerTreeOnNarrowViewport)
    observer.observe(viewport)
    centerTreeOnNarrowViewport()
    return () => observer.disconnect()
  }, [])

  if (state.hypotheses.length === 0)
    return (
      <div className="evolution-empty">
        <GitBranch className="h-5 w-5" />
        运行后显示假说提出、证据变化与逐轮检验过程。
      </div>
    )

  const drillHypothesis = state.hypotheses.find((item) => item.id === drillHypothesisId) ?? null
  if (drillHypothesis) {
    return (
      <HypothesisLineageDetail
        state={state}
        hypothesis={drillHypothesis}
        hypothesisIndex={state.hypotheses.findIndex((item) => item.id === drillHypothesis.id)}
        rounds={rounds}
        playbackRound={playbackRound}
        onRoundChange={setPlaybackRound}
        onBack={() => setDrillHypothesisId(null)}
        rootRef={rootRef}
      />
    )
  }

  const focusNode = tree.nodes.find((node) => node.id === hoveredId) ?? null
  const isRelated = (index: number) => !focusNode || focusNode.hypothesisIndex === index

  return (
    <section
      ref={rootRef}
      className={`evolution-shell evolution-compact-shell ${focusNode ? 'has-focus' : ''}`}
      aria-label="假设演化树"
    >
      <header className="evolution-header">
        <div>
          <div className="eyebrow-mono text-emerald-200/70">
            HYPOTHESIS LINEAGE / ROUND BY ROUND
          </div>
          <h1>假设演化树</h1>
          <p>
            选择轮次查看该轮新增的假说版本、证据与判断变化。切换到下一轮时，已有分支保持不动，新一轮从上一轮下方继续生长。
            <span className="text-amber-200/70">鼠标悬停节点可查看完整信息</span>
          </p>
        </div>
        <EvolutionRoundSelector rounds={rounds} value={playbackRound} onChange={setPlaybackRound} />
      </header>

      <div ref={viewportRef} className="evolution-tree-viewport">
        <motion.div
          className="evolution-tree-canvas evolution-lineage-canvas"
          style={{
            // 每个 lineage 节点单元宽 190px；节点多时按数量加宽画布（视口横向滚动），
            // 否则百分比定位会把相邻节点的标注挤压重叠。
            minWidth: `${Math.max(
              100,
              ...tree.processes.map(
                (p) => (p.continuedHypothesisCount + p.newHypothesisCount) * 14,
              ),
            )}rem`,
          }}
          animate={{ height: canvasHeight }}
          transition={{ duration: reduceMotion ? 0.01 : 0.34, ease: 'easeOut' }}
        >
          <svg
            className="evolution-tree-edges"
            viewBox={`0 0 1000 ${canvasHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <AnimatePresence initial={false}>
              {tree.edges.map((edge) => (
                <motion.path
                  key={edge.id}
                  d={edge.path}
                  className={isRelated(edge.hypothesisIndex) ? 'is-related' : 'is-dimmed'}
                  initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ pathLength: 0, opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0.01 : 0.48, ease: 'easeOut' }}
                />
              ))}
            </AnimatePresence>
          </svg>

          <div
            className="evolution-lineage-root"
            style={{ left: '50%', top: 55 }}
            title={state.phenomenon?.title ?? '科学现象'}
          >
            <span>
              <SunMedium />
            </span>
            <div>
              <strong>输入现象</strong>
              <small>{compact(state.phenomenon?.title ?? '科学现象', 30)}</small>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {tree.processes.map((process) => (
              <motion.div
                key={process.round}
                className="evolution-process-rail"
                style={{ top: process.y }}
                initial={reduceMotion ? false : { opacity: 0, y: -10, scaleX: 0.94 }}
                animate={{ opacity: 1, y: 0, scaleX: 1 }}
                exit={{ opacity: 0, y: -8, scaleX: 0.96 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.3 }}
              >
                <span>ROUND {process.round}</span>
                <strong>
                  {process.round === 1
                    ? `提出 ${process.newHypothesisCount} 个假说`
                    : `${process.newHypothesisCount} 个新假说 · ${process.continuedHypothesisCount} 个延续检验 · ${process.judgmentChangedCount} 个判断变化`}
                </strong>
                <div>
                  <small>
                    <Database />
                    处理 {process.processingCount}
                  </small>
                  <small>
                    <BookOpenCheck />
                    证据 {process.evidenceCount}
                  </small>
                  <small>
                    <ShieldCheck />
                    校正 {process.correctionCount}
                  </small>
                  <small>
                    <Wrench />
                    执行任务 {process.executedTaskCount}
                  </small>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {tree.nodes.map((node) => {
            const active = focusNode?.id === node.id
            const evidenceTotal = node.support + node.contradict + node.unknown
            return (
              <div
                key={node.id}
                className={`evolution-branch-unit ${isRelated(node.hypothesisIndex) ? 'is-related' : 'is-dimmed'}`}
                style={{ left: `${node.x / 10}%`, top: node.y }}
              >
                <motion.span
                  className={`evolution-branch-change is-${node.verdict}`}
                  initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0.01 : 0.3 }}
                >
                  <b>{node.action}</b>
                  <small>{node.change}</small>
                </motion.span>
                <motion.button
                  type="button"
                  className={`evolution-node evolution-lineage-node is-${node.verdict} ${active ? 'is-focused' : ''}`}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId(null)}
                  onClick={() => {
                    setHoveredId(null)
                    setPlaybackRound(node.round)
                    setDrillHypothesisId(node.hypothesis.id)
                  }}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.86, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{
                    duration: reduceMotion ? 0.01 : 0.3,
                    delay: node.hypothesisIndex * 0.035,
                  }}
                  whileTap={{ scale: 0.94 }}
                >
                  <span className="evolution-node-core">
                    <i />
                    <strong>H{node.hypothesisIndex + 1}</strong>
                  </span>
                  <span className="evolution-node-step">
                    第 {node.round} 轮 ·{' '}
                    {node.round === (node.hypothesis.round ?? 1) ? '提出' : '复核'}
                  </span>
                  <span className="evolution-node-verdict">
                    {evidenceTotal} 条证据 · {verdictLabel(node.verdict)}
                  </span>
                  <AnimatePresence>
                    {hoveredId === node.id && (
                      <motion.span
                        className="evolution-node-tooltip"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 3 }}
                      >
                        <b>{node.hypothesis.statement}</b>
                        <small>
                          {node.action}；{node.change}；{node.deterministic} 条确定性溯源；
                          {node.executedTaskCount} 项关联任务已执行。
                        </small>
                        <em>点击进入该假说的多层系谱</em>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              </div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}

export default EvolutionTree
