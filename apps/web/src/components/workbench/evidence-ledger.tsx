'use client'

import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, XCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { WorkbenchEvidence } from '@/lib/workbench/state'
import { evidenceCounts } from '@/lib/workbench/scientific-rounds'

const STATUS = {
  support: { label: '支持', icon: CheckCircle2, color: 'text-emerald-300', line: 'bg-emerald-400' },
  contradict: { label: '反驳', icon: XCircle, color: 'text-rose-300', line: 'bg-rose-400' },
  unknown: { label: '证据不足', icon: CircleHelp, color: 'text-amber-200', line: 'bg-amber-300' },
} as const

export function EvidenceLedger({
  evidence,
  round,
}: {
  evidence: WorkbenchEvidence[]
  round?: number
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const counts = evidenceCounts(evidence)
  return (
    <section className="workbench-panel flex min-h-[290px] flex-col overflow-hidden">
      <div className="workbench-panel-header">
        <div>
          <div className="eyebrow-mono text-cyan-200/70">证据记录</div>
          <h2 className="mt-1 text-base font-medium text-white">
            {round ? `第 ${round} 轮证据判读` : '证据账本'}
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
          {evidence.length} 条记录
        </div>
      </div>
      {evidence.length > 0 && (
        <div className="evidence-scope-summary">
          <div>
            <span>支持性指标</span>
            <strong>{counts.support}</strong>
          </div>
          <div>
            <span>反例 / 不一致</span>
            <strong>{counts.contradict}</strong>
          </div>
          <div>
            <span>不足以判定</span>
            <strong>{counts.unknown}</strong>
          </div>
          <div>
            <span>确定性溯源</span>
            <strong>{counts.deterministic}</strong>
          </div>
          <p>
            “证据不足”表示该记录已经过处理或审阅，但现有指标不具区分性、缺少必要测量，不能据此支持或反驳假设；不等于任务尚未执行。
          </p>
        </div>
      )}
      <div className="flex-1 divide-y divide-white/[0.07] overflow-y-auto">
        {evidence.length === 0 && (
          <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-xs leading-6 text-[var(--color-text-muted)]">
            分析后，这里会按“支持性指标 / 反例 / 证据不足”登记每条记录，并说明实际完成的数据处理。
          </div>
        )}
        {evidence.map((item, index) => {
          const status = STATUS[item.status as keyof typeof STATUS] ?? STATUS.unknown
          const Icon = status.icon
          const isOpen = expanded === item.evidenceId
          return (
            <motion.div
              key={item.evidenceId}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : item.evidenceId)}
                className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.035]"
              >
                <span className={`mt-0.5 h-8 w-1 rounded-full ${status.line} opacity-80`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    <Icon className={`h-3.5 w-3.5 ${status.color}`} />
                    <span className={status.color}>{status.label}</span>
                    <span>·</span>
                    <span className="truncate">{item.evidenceId}</span>
                  </span>
                  <span className="mt-1 block text-[14px] leading-5 text-[var(--color-body)]">
                    {item.claim}
                  </span>
                </span>
                <ChevronDown
                  className={`mt-1 h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-8 mr-4 mb-3 rounded-lg border border-white/[0.07] bg-black/20 p-3 text-xs leading-5 text-[var(--color-text-muted)]">
                      <p>
                        <span className="text-[var(--color-body)]">观察：</span>
                        {item.observed ?? '未提供'}
                      </p>
                      <p className="mt-1">
                        <span className="text-[var(--color-body)]">方法：</span>
                        {item.method ?? '未提供'}
                      </p>
                      <p className="mt-1">
                        <span className="text-[var(--color-body)]">证据性质：</span>
                        {item.provenance?.deterministic
                          ? '确定性处理证据'
                          : '模型解释或待补溯源记录'}
                      </p>
                      {item.provenance && (
                        <div className="mt-2 rounded-md border border-cyan-200/10 bg-cyan-200/[0.035] p-2 font-mono text-[11px] leading-5 text-cyan-100/60">
                          <div>processing run · {item.provenance.processingRunId}</div>
                          <div>generated by · {item.provenance.generatedBy}</div>
                          <div>
                            {item.provenance.dataSnapshotIds.length} snapshots ·{' '}
                            {item.provenance.artifactIds.length} artifacts
                          </div>
                        </div>
                      )}
                      {item.sourceIds && item.sourceIds.length > 0 && (
                        <p className="mt-1">
                          <span className="text-[var(--color-body)]">来源：</span>
                          {item.sourceIds.join(' · ')}
                        </p>
                      )}
                      {item.uncertainty && (
                        <p className="mt-1">
                          <span className="text-[var(--color-body)]">不确定性：</span>
                          {item.uncertainty}
                        </p>
                      )}
                      {item.limitations && item.limitations.length > 0 && (
                        <p className="mt-1 text-amber-100/70">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          {item.limitations.join('；')}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
