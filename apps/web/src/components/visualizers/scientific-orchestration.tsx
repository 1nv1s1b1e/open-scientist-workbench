'use client'

import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  GitBranch,
  History,
  LoaderCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentRole } from '@/lib/types/visualizers'
import {
  buildOrchestrationViewModel,
  toConsoleAgentRole,
  type OrchestrationNodeView,
  type OrchestrationSelection,
  type OrchestrationWorkerView,
} from '@/lib/workbench/orchestration-view-model'
import type { ScientificOrchestrationState } from '@/lib/workbench/state'
import { scientificAgentIdentity } from '@open-scientist/schema'

const EMPTY_ORCHESTRATION: ScientificOrchestrationState = {
  nodes: [],
  agents: [],
  latestRoute: null,
}

interface ScientificOrchestrationProps {
  state?: ScientificOrchestrationState
  isDemo?: boolean
  selectedAgent?: AgentRole | null
  onSelectAgent?: (role: AgentRole | null) => void
}

function StatusGlyph({
  state,
}: {
  state: 'idle' | 'running' | 'completed' | 'failed' | 'queued' | 'skipped'
}) {
  if (state === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
  if (state === 'completed') return <Check className="h-3.5 w-3.5" />
  if (state === 'failed') return <XCircle className="h-3.5 w-3.5" />
  return <CircleDot className="h-3.5 w-3.5" />
}

function NodeCard({
  node,
  selected,
  dimmed,
  onSelect,
}: {
  node: OrchestrationNodeView
  selected: boolean
  dimmed: boolean
  onSelect: () => void
}) {
  const structural = node.id === 'explorer.dispatch' || node.id === 'explorer.aggregate'
  const visibleStatus = structural && node.state === 'idle' ? '图内步骤' : node.stateLabel
  return (
    <motion.button
      type="button"
      layout
      onClick={onSelect}
      className={`orchestration-node-card orchestration-state-${node.state} ${structural ? 'orchestration-node-structural' : ''} ${selected ? 'orchestration-node-selected' : ''} ${dimmed ? 'orchestration-round-dimmed' : ''}`}
    >
      <span className="orchestration-node-icon">
        <StatusGlyph state={node.state} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="orchestration-node-card-meta">
          <code>{node.id}</code>
          <em>{visibleStatus}</em>
        </span>
        <strong>{node.title}</strong>
        <small>{node.description}</small>
      </span>
    </motion.button>
  )
}

function WorkerCard({
  worker,
  selected,
  dimmed,
  onSelect,
}: {
  worker: OrchestrationWorkerView
  selected: boolean
  dimmed: boolean
  onSelect: () => void
}) {
  return (
    <motion.button
      type="button"
      layout
      onClick={onSelect}
      className={`orchestration-worker-card orchestration-state-${worker.state} ${selected ? 'orchestration-worker-selected' : ''} ${dimmed ? 'orchestration-round-dimmed' : ''}`}
    >
      <span className="orchestration-worker-top">
        <span className="orchestration-worker-dot">
          <StatusGlyph state={worker.state} />
        </span>
        <em>{worker.stateLabel}</em>
      </span>
      <strong>{worker.title}</strong>
      {worker.executionKind && (
        <small>{worker.executionKind === 'model' ? '模型审阅' : '确定性计算 / 核验'}</small>
      )}
      <small>{worker.message ?? worker.description}</small>
    </motion.button>
  )
}

export function ScientificOrchestration({
  state,
  isDemo = false,
  selectedAgent,
  onSelectAgent,
}: ScientificOrchestrationProps) {
  const orchestration = state ?? EMPTY_ORCHESTRATION
  const view = useMemo(() => buildOrchestrationViewModel(orchestration), [orchestration])
  const [selection, setSelection] = useState<OrchestrationSelection | null>(view.suggestedSelection)
  const [focusedRound, setFocusedRound] = useState<number | null>(null)

  useEffect(() => {
    setSelection((current) => {
      if (
        current?.kind === 'node' &&
        view.stages.some((stage) => stage.nodes.some((node) => node.id === current.id))
      )
        return current
      if (
        current?.kind === 'worker' &&
        view.workers.items.some((worker) => worker.id === current.id)
      )
        return current
      return view.suggestedSelection
    })
  }, [view])

  useEffect(() => {
    if (!selectedAgent) return
    setSelection((current) => {
      const currentWorker =
        current?.kind === 'worker'
          ? view.workers.items.find((worker) => worker.id === current.id)
          : null
      if (currentWorker?.role === selectedAgent) return current
      const candidates = view.workers.items.filter((worker) => worker.role === selectedAgent)
      const exact =
        candidates.find((worker) => worker.state === 'running') ??
        candidates.find((worker) => worker.executionKind === 'model') ??
        candidates[0]
      return exact ? { kind: 'worker', id: exact.id } : current
    })
  }, [selectedAgent, view.workers.items])

  const selectedNode =
    selection?.kind === 'node'
      ? (view.stages.flatMap((stage) => stage.nodes).find((node) => node.id === selection.id) ??
        null)
      : null
  const selectedWorker =
    selection?.kind === 'worker'
      ? (view.workers.items.find((worker) => worker.id === selection.id) ?? null)
      : null
  const selectedStageId = selectedNode
    ? (view.stages.find((stage) => stage.nodes.some((node) => node.id === selectedNode.id))?.id ??
      null)
    : selectedWorker
      ? (view.stages.find((stage) =>
          stage.nodes.some(
            (node) =>
              node.stage ===
              ({
                librarian: 'librarian',
                looker: 'surveyor',
                explore: 'explorer',
                oracle: 'explorer',
                sisyphus: 'oracle',
                prometheus: 'prometheus',
              }[selectedWorker.role] ?? 'explorer'),
          ),
        )?.id ?? null)
      : null
  const selectedStageIndex = selectedStageId
    ? view.stages.findIndex((stage) => stage.id === selectedStageId)
    : -1
  const orchestrationRounds = useMemo(() => {
    const rounds = new Set<number>()
    view.stages
      .flatMap((stage) => stage.nodes)
      .forEach((node) => {
        if (node.round != null) rounds.add(node.round)
      })
    view.workers.items.forEach((worker) => {
      if (worker.round != null) rounds.add(worker.round)
    })
    if (view.route.round != null) rounds.add(view.route.round)
    return [...rounds].sort((left, right) => left - right)
  }, [view])
  const activeFocusedRound =
    focusedRound != null && orchestrationRounds.includes(focusedRound) ? focusedRound : null
  const isRoundDimmed = (itemRound: number | null) =>
    activeFocusedRound != null && itemRound != null && itemRound !== activeFocusedRound
  const runtimeNodes = view.stages
    .flatMap((stage) => stage.nodes)
    .filter((node) => node.id !== 'explorer.dispatch' && node.id !== 'explorer.aggregate')
  const completedNodes = runtimeNodes.filter((node) => node.state === 'completed').length
  const activeWorkers = view.workers.summary.running
  const completedWorkers = view.workers.summary.completed
  const queuedWorkers = view.workers.summary.queued
  const deterministicWorkers = view.workers.items.filter(
    (worker) => worker.executionKind !== 'model',
  )
  const modelWorkers = view.workers.items.filter((worker) => worker.executionKind === 'model')
  const hasRecordedState = orchestration.nodes.length > 0 || orchestration.agents.length > 0
  const runStateLabel = isDemo
    ? '示例状态'
    : activeWorkers > 0
      ? '实时状态'
      : hasRecordedState
        ? '已回放状态'
        : '等待运行'
  const round =
    view.route.round ??
    view.stages.flatMap((stage) => stage.nodes).find((node) => node.round != null)?.round ??
    1
  const activeStage =
    view.stages.find((stage) => stage.nodes.some((node) => node.state === 'running')) ??
    view.stages.find((stage) => stage.id === view.route.target) ??
    view.stages.find((stage) => stage.nodes.some((node) => node.state !== 'completed')) ??
    view.stages[0]
  const activeStageLabel = activeStage ? activeStage.title : '等待运行'

  const selectWorker = (worker: OrchestrationWorkerView) => {
    setSelection({ kind: 'worker', id: worker.id })
    onSelectAgent?.(toConsoleAgentRole(worker.id))
  }

  const isWorkerSelected = (worker: OrchestrationWorkerView): boolean =>
    selection?.kind === 'worker' && selection.id === worker.id

  const selectNode = (id: string) => {
    setSelection({ kind: 'node', id })
    onSelectAgent?.(null)
  }

  return (
    <section className="orchestration-shell" aria-label="科学闭环编排">
      <header className="orchestration-header">
        <div>
          <div className="eyebrow-mono">运行编排</div>
          <h1 className="orchestration-title">科学闭环控制台</h1>
          <p className="orchestration-description">
            查看七阶段节点、Explorer
            阶段的确定性并行计算与模型串行审阅，以及本轮最终路由。点击节点可核对读写内容。
          </p>
        </div>
        <div className="orchestration-header-actions">
          {orchestrationRounds.length > 1 && (
            <label className="orchestration-round-control">
              <History className="h-3.5 w-3.5" />
              <span>轮次聚焦</span>
              <select
                value={activeFocusedRound ?? ''}
                onChange={(event) =>
                  setFocusedRound(event.target.value === '' ? null : Number(event.target.value))
                }
                aria-label="编排轮次聚焦"
              >
                <option value="">当前轮</option>
                {orchestrationRounds.map((availableRound) => (
                  <option key={availableRound} value={availableRound}>
                    第 {availableRound} 轮
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="orchestration-live-label">
            <span className="orchestration-footer-dot" />
            {runStateLabel}
          </span>
          <span className="orchestration-round">第 {round} 轮</span>
        </div>
      </header>

      <div className="orchestration-summary" aria-label="编排摘要">
        <div>
          <span>当前阶段</span>
          <strong>{activeStageLabel}</strong>
        </div>
        <div>
          <span>运行节点</span>
          <strong>
            {completedNodes} / {runtimeNodes.length} 已完成
          </strong>
        </div>
        <div>
          <span>证据工作项</span>
          <strong>
            {activeWorkers > 0
              ? `${activeWorkers} 项进行中`
              : completedWorkers > 0
                ? `${completedWorkers} 项已完成${queuedWorkers > 0 ? ` · ${queuedWorkers} 项排队` : ''}`
                : queuedWorkers > 0
                  ? `${queuedWorkers} 项排队`
                  : '等待分发'}
          </strong>
        </div>
        <div>
          <span>下一路径</span>
          <strong>{view.route.label}</strong>
        </div>
        <div>
          <span>当前选择</span>
          <strong>{selectedNode?.title ?? selectedWorker?.title ?? '尚未选择'}</strong>
        </div>
      </div>

      <div className="orchestration-control-grid">
        <div
          className={
            selection
              ? 'orchestration-canvas orchestration-selection-active'
              : 'orchestration-canvas'
          }
        >
          <div className="orchestration-canvas-topline">
            <span>流程路径</span>
            <div className="orchestration-legend" aria-label="节点类型图例">
              <span>
                <i className="orchestration-legend-control" />
                流程节点
              </span>
              <span>
                <i className="orchestration-legend-agent" />
                智能体任务
              </span>
              <span>
                <i className="orchestration-legend-active" />
                当前焦点
              </span>
            </div>
          </div>
          <div className="orchestration-stage-grid">
            {view.stages.map((stage, index) => (
              <div key={stage.id} className="contents">
                <section
                  className={
                    'orchestration-stage-card orchestration-stage-' +
                    stage.id +
                    ' ' +
                    (selectedStageId === stage.id
                      ? 'orchestration-stage-focused'
                      : selectedStageId
                        ? 'orchestration-stage-context'
                        : '')
                  }
                  aria-label={`${stage.id} 阶段：${stage.title}`}
                >
                  <header>
                    <span>{index + 1}</span>
                    <div>
                      <h2>{stage.title}</h2>
                      <p>{stage.description}</p>
                    </div>
                  </header>
                  <div className="orchestration-stage-nodes">
                    {stage.nodes
                      .slice(0, stage.id === 'explorer' ? 2 : stage.nodes.length)
                      .map((node) => (
                        <NodeCard
                          key={node.id}
                          node={node}
                          selected={selection?.kind === 'node' && selection.id === node.id}
                          dimmed={isRoundDimmed(node.round)}
                          onSelect={() => selectNode(node.id)}
                        />
                      ))}
                    {stage.id === 'explorer' && (
                      <>
                        <div className="orchestration-worker-lane orchestration-worker-lane-deterministic">
                          <header>
                            <span>确定性并行</span>
                            <small>{deterministicWorkers.length} 项 · 相同输入与参数可复现</small>
                          </header>
                          <div className="orchestration-worker-grid">
                            {deterministicWorkers.map((worker) => (
                              <WorkerCard
                                key={worker.id}
                                worker={worker}
                                selected={isWorkerSelected(worker)}
                                dimmed={isRoundDimmed(worker.round)}
                                onSelect={() => selectWorker(worker)}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="orchestration-parallel-divider">
                          <span>结构化证据进入模型审阅</span>
                        </div>
                        <div className="orchestration-worker-lane orchestration-worker-lane-model">
                          <header>
                            <span>模型串行审阅</span>
                            <small>观测质控 → 物理诊断 → 反证审计</small>
                          </header>
                          <div className="orchestration-worker-grid orchestration-worker-grid-model">
                            {modelWorkers.map((worker) => (
                              <WorkerCard
                                key={worker.id}
                                worker={worker}
                                selected={isWorkerSelected(worker)}
                                dimmed={isRoundDimmed(worker.round)}
                                onSelect={() => selectWorker(worker)}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="orchestration-parallel-divider orchestration-parallel-divider-return">
                          <span>汇总、事实核验并返回</span>
                        </div>
                        {stage.nodes.slice(2).map((node) => (
                          <NodeCard
                            key={node.id}
                            node={node}
                            selected={selection?.kind === 'node' && selection.id === node.id}
                            dimmed={isRoundDimmed(node.round)}
                            onSelect={() => selectNode(node.id)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                </section>
                {index < view.stages.length - 1 && (
                  <div
                    className={
                      selectedStageIndex >= 0 && Math.abs(index - selectedStageIndex) <= 1
                        ? 'orchestration-stage-arrow orchestration-stage-arrow-focused'
                        : 'orchestration-stage-arrow'
                    }
                    aria-hidden="true"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <section
            className={`orchestration-route-band orchestration-route-${view.route.target.toLowerCase()}`}
            aria-label="下一轮路由"
          >
            <div className="orchestration-route-mark">
              <GitBranch className="h-4 w-4" />
            </div>
            <div>
              <span>循环控制</span>
              <strong>{view.route.label}</strong>
              <p>{view.route.reason ?? 'Prometheus 阶段完成后会在这里登记下一条路径。'}</p>
            </div>
            <div className="orchestration-route-target">
              <span>Prometheus</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <b>
                {view.route.target === 'WAIT'
                  ? '—'
                  : view.route.target === 'END'
                    ? '本轮结束'
                    : view.route.target === 'librarian'
                      ? 'Librarian'
                      : 'Explorer'}
              </b>
            </div>
          </section>
        </div>

        <aside className="orchestration-inspector" aria-live="polite">
          <div className="orchestration-inspector-title">
            <GitBranch className="h-4 w-4" />
            当前步骤
          </div>
          {selectedNode && (
            <div className="orchestration-inspector-focus">
              <span
                className={`orchestration-inspector-status orchestration-state-${selectedNode.state}`}
              >
                <StatusGlyph state={selectedNode.state} />
                {selectedNode.stateLabel}
              </span>
              <h2>{selectedNode.title}</h2>
              <p>{selectedNode.description}</p>
              <dl>
                <div>
                  <dt>读取</dt>
                  <dd>{selectedNode.reads}</dd>
                </div>
                <div>
                  <dt>写入</dt>
                  <dd>{selectedNode.writes}</dd>
                </div>
                <div>
                  <dt>所属阶段</dt>
                  <dd>
                    {view.stages.find((stage) => stage.id === selectedStageId)?.title ??
                      selectedStageId ??
                      '—'}
                  </dd>
                </div>
                <div>
                  <dt>记录轮次</dt>
                  <dd>{selectedNode.round ?? '—'}</dd>
                </div>
              </dl>
              {selectedNode.round != null && <small>第 {selectedNode.round} 轮</small>}
            </div>
          )}
          {selectedWorker && (
            <div className="orchestration-inspector-focus">
              <span
                className={`orchestration-inspector-status orchestration-state-${selectedWorker.state}`}
              >
                <StatusGlyph state={selectedWorker.state} />
                {selectedWorker.stateLabel}
              </span>
              <h2>{selectedWorker.title}</h2>
              <p>{selectedWorker.message ?? selectedWorker.description}</p>
              <dl>
                <div>
                  <dt>所属工作组</dt>
                  <dd>Explorer · 证据工作组</dd>
                </div>
                <div>
                  <dt>执行方式</dt>
                  <dd>
                    {selectedWorker.executionKind === 'model' ? '模型审阅' : '确定性计算 / 核验'}
                  </dd>
                </div>
                <div>
                  <dt>控制台筛选</dt>
                  <dd>
                    {(() => {
                      const identity = scientificAgentIdentity(selectedWorker.role)
                      return identity
                        ? `${identity.codename} · ${identity.displayName}`
                        : selectedWorker.role
                    })()}
                  </dd>
                </div>
                <div>
                  <dt>记录轮次</dt>
                  <dd>{selectedWorker.round ?? '—'}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="orchestration-console-filter"
                onClick={() => onSelectAgent?.(selectedWorker.role)}
              >
                在运行记录中筛选 <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {!selectedNode && !selectedWorker && (
            <div className="orchestration-inspector-empty">
              <CircleDot className="h-5 w-5" />
              <p>选择一个流程节点或工作项，查看它在本轮读取和写入的内容。</p>
            </div>
          )}
          <div className="orchestration-inspector-boundary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>
              {
                '\u8fd9\u91cc\u4fdd\u7559\u7f16\u6392\u72b6\u6001\u4e0e\u7ed3\u6784\u5316\u4ea7\u7269\uff1b\u6a21\u578b\u5bf9\u5916\u6458\u8981\u3001\u5de5\u5177\u8c03\u7528\u3001\u8bc1\u636e\u53f0\u8d26\u8bf7\u5728\u201c\u6267\u884c\u8f68\u8ff9\u201d\u67e5\u770b\u3002'
              }
            </span>
          </div>
          <div className="orchestration-inspector-source">
            <Database className="h-3.5 w-3.5" />
            状态来自当前运行的节点、工作项和路由事件。
          </div>
        </aside>
      </div>
    </section>
  )
}
