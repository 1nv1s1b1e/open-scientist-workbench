'use client'

import {
  ArrowDown,
  Beaker,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FlaskConical,
  Route,
} from 'lucide-react'
import { motion } from 'motion/react'
import type { WorkbenchEvidence, WorkbenchValidationTask } from '@/lib/workbench/state'
import { taskExecutionRound } from '@/lib/workbench/scientific-rounds'

function executorLabel(executorId?: string): string {
  if (!executorId) return '尚未绑定执行器'
  if (executorId === 'external') return '需要外部数据、算法或人工处理'
  return executorId
}

function TaskCard({
  task,
  evidence,
  mode,
  index,
}: {
  task: WorkbenchValidationTask
  evidence: WorkbenchEvidence[]
  mode: 'executed' | 'runnable' | 'external' | 'completed-later'
  index: number
}) {
  const executionRound = taskExecutionRound(task, evidence)
  const resultCount = task.resultEvidenceIds?.length ?? 0
  const Icon =
    mode === 'executed' || mode === 'completed-later'
      ? CheckCircle2
      : mode === 'external'
        ? ExternalLink
        : Beaker
  const status =
    mode === 'executed'
      ? `本轮已执行 · 生成 ${resultCount} 条结果证据`
      : mode === 'completed-later'
        ? `第 ${executionRound ?? '?'} 轮已完成`
        : mode === 'external'
          ? '尚不能由当前系统自动完成'
          : '已匹配本地执行器，等待下一轮运行'

  return (
    <motion.article
      key={task.taskId}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035 }}
      className={`task-row task-row-${mode}`}
    >
      <span className="task-status-icon">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="task-row-meta">
          <span>{status}</span>
          <code>{task.taskId}</code>
        </div>
        <p>{task.objective}</p>
        <dl>
          <div>
            <dt>执行方式</dt>
            <dd>{executorLabel(task.executorId)}</dd>
          </div>
          <div>
            <dt>区分结果</dt>
            <dd>{task.discriminatingOutcomes?.length ?? 0} 项判据</dd>
          </div>
          <div>
            <dt>所需来源</dt>
            <dd>{task.requiredSourceIds?.length ?? 0} 个</dd>
          </div>
          <div>
            <dt>路由</dt>
            <dd>{task.route === 'B' ? '补充证据' : '返回假设/外部能力'}</dd>
          </div>
        </dl>
      </div>
    </motion.article>
  )
}

function TaskLane({
  title,
  description,
  tasks,
  evidence,
  mode,
}: {
  title: string
  description: string
  tasks: WorkbenchValidationTask[]
  evidence: WorkbenchEvidence[]
  mode: 'executed' | 'runnable' | 'external' | 'completed-later'
}) {
  if (tasks.length === 0) return null
  return (
    <section className="task-lane">
      <header>
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        <span>{tasks.length}</span>
      </header>
      <div className="task-lane-list">
        {tasks.map((task, index) => (
          <TaskCard key={task.taskId} task={task} evidence={evidence} mode={mode} index={index} />
        ))}
      </div>
    </section>
  )
}

export function ValidationQueue({
  tasks,
  evidence,
  round,
}: {
  tasks: WorkbenchValidationTask[]
  evidence: WorkbenchEvidence[]
  round: number
}) {
  const executed = tasks.filter((task) => taskExecutionRound(task, evidence) === round)
  const proposed = tasks.filter((task) => task.round === round)
  const completedLater = proposed.filter(
    (task) => task.status === 'completed' && taskExecutionRound(task, evidence) !== round,
  )
  const runnable = proposed.filter(
    (task) => task.status === 'planned' && task.executorId && task.executorId !== 'external',
  )
  const external = proposed.filter(
    (task) => task.status === 'planned' && (!task.executorId || task.executorId === 'external'),
  )

  return (
    <section className="workbench-panel task-queue-panel">
      <div className="workbench-panel-header">
        <div>
          <div className="eyebrow-mono text-violet-200/70">任务路由 / 第 {round} 轮</div>
          <h2 className="mt-1 text-base font-medium text-white">执行了什么，接下来做什么</h2>
        </div>
        <Route className="h-4 w-4 text-violet-200/70" />
      </div>
      <div className="task-route-explainer">
        <span>
          <CheckCircle2 className="h-3.5 w-3.5" /> 已执行任务必须有结果证据
        </span>
        <ArrowDown className="h-3.5 w-3.5" />
        <span>
          <Clock3 className="h-3.5 w-3.5" /> 新任务按执行器能力进入下一轮或外部队列
        </span>
      </div>
      <div className="task-queue-lanes">
        <TaskLane
          title="本轮实际执行"
          description="这些任务在本轮调用了注册执行器，并写回结果证据。"
          tasks={executed}
          evidence={evidence}
          mode="executed"
        />
        <TaskLane
          title="本轮提出，后续已完成"
          description="任务在本轮形成，但结果来自后续轮次；时间边界不会混写。"
          tasks={completedLater}
          evidence={evidence}
          mode="completed-later"
        />
        <TaskLane
          title="系统内可执行"
          description="已有注册执行器，进入下一轮后可以自动处理。"
          tasks={runnable}
          evidence={evidence}
          mode="runnable"
        />
        <TaskLane
          title="需要外部能力"
          description="当前缺少数据、算法或人工步骤，保持计划状态，不伪装为已完成。"
          tasks={external}
          evidence={evidence}
          mode="external"
        />
        {executed.length + proposed.length === 0 && (
          <div className="workbench-empty-result">
            <FlaskConical className="h-5 w-5" />
            <p>第 {round} 轮没有登记任务</p>
            <span>任务只在明确的证据缺口和区分性结果存在时生成。</span>
          </div>
        )}
      </div>
    </section>
  )
}
