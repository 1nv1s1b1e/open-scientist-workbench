'use client'

import { Activity, DatabaseZap, FileCheck2, ImageIcon, Waves } from 'lucide-react'
import { useMemo, useState } from 'react'
import { apiEndpoint } from '@/lib/api/client'
import type { WorkbenchProcessingResult } from '@/lib/workbench/state'

function numeric(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '未计算'
}

function statusLabel(value: unknown): string {
  if (value === 'support') return '检测到对应指标'
  if (value === 'contradict') return '指标与预测不一致'
  return '信息不足 / 尚未满足判据'
}

export function ProcessingResults({ results }: { results: WorkbenchProcessingResult[] }) {
  const ordered = useMemo(
    () => [...results].sort((left, right) => right.round - left.round),
    [results],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = ordered.find((item) => item.processingRunId === selectedId) ?? ordered[0]

  if (!selected) {
    return (
      <div className="workbench-empty-result">
        <DatabaseZap className="h-5 w-5" />
        <p>尚未产生数据处理运行</p>
        <span>
          开始分析后，这里会展示实际读取的 FITS 数量、诊断指标、对照窗口和带校验和的处理产物。
        </span>
      </div>
    )
  }

  const wave = selected.diagnostics.wave ?? {}
  const reconnection = selected.diagnostics.reconnection ?? {}
  const coupled = selected.diagnostics.coupled ?? {}
  const periods = Array.isArray(wave.periodsSeconds)
    ? wave.periodsSeconds.map((value) => `${numeric(value, 0)} 秒`).join(' / ')
    : '未计算'

  return (
    <section className="processing-result-panel">
      <header className="processing-result-head">
        <div>
          <div className="eyebrow-mono text-cyan-200/70">确定性处理运行</div>
          <h2>{selected.caseLabel}</h2>
          <p>
            {selected.mode === 'validation' ? '验证轮复测' : '探索轮分析'} · 实际读取{' '}
            {selected.usedObservationCount} 条观测
          </p>
        </div>
        <div className="processing-round-switch" aria-label="处理轮次">
          {ordered.map((item) => (
            <button
              type="button"
              key={item.processingRunId}
              className={item.processingRunId === selected.processingRunId ? 'is-active' : ''}
              onClick={() => setSelectedId(item.processingRunId)}
            >
              第 {item.round} 轮
            </button>
          ))}
        </div>
      </header>

      <div className="processing-diagnostic-grid">
        <article data-status={String(wave.observableStatus ?? 'unknown')}>
          <Waves className="h-4 w-4" />
          <div>
            <span>波动时序</span>
            <strong>{statusLabel(wave.observableStatus)}</strong>
          </div>
          <dl>
            <div>
              <dt>候选周期</dt>
              <dd>{periods}</dd>
            </div>
            <div>
              <dt>周期覆盖</dt>
              <dd>{numeric(wave.cyclesCovered)} 个周期</dd>
            </div>
            <div>
              <dt>171/193 相关</dt>
              <dd>{numeric(wave.crossChannelCorrelation)}</dd>
            </div>
            <div>
              <dt>相对时延</dt>
              <dd>{numeric(wave.crossChannelLagSeconds, 0)} 秒</dd>
            </div>
          </dl>
        </article>
        <article data-status={String(reconnection.observableStatus ?? 'unknown')}>
          <Activity className="h-4 w-4" />
          <div>
            <span>间歇热响应</span>
            <strong>{statusLabel(reconnection.observableStatus)}</strong>
          </div>
          <dl>
            <div>
              <dt>热通道峰数</dt>
              <dd>{numeric(reconnection.hotChannelPeakCount, 0)}</dd>
            </div>
            <div>
              <dt>目标/背景变异</dt>
              <dd>{numeric(reconnection.targetToBackgroundVariabilityRatio)}</dd>
            </div>
            <div>
              <dt>HMI 变化代理</dt>
              <dd>{numeric(reconnection.magneticProxySlopePerHour)}</dd>
            </div>
          </dl>
        </article>
        <article data-status={String(coupled.observableStatus ?? 'unknown')}>
          <FileCheck2 className="h-4 w-4" />
          <div>
            <span>联合指标</span>
            <strong>{coupled.jointIndicatorsPresent === true ? '同窗出现' : '未同时出现'}</strong>
          </div>
          <p>
            这里只检查多类可观测量是否同时出现，不估算机制贡献比例，也不把相关性解释成因果耦合。
          </p>
        </article>
      </div>

      <div className="processing-artifact-grid">
        <div className="processing-figure">
          <div className="processing-figure-label">
            <ImageIcon className="h-3.5 w-3.5" />
            同一 ROI 的多波段时序与变异度
          </div>
          {selected.figureUrl ? (
            <img src={apiEndpoint(selected.figureUrl)} alt={`${selected.caseLabel} 多波段诊断图`} />
          ) : (
            <div className="processing-figure-empty">诊断图地址未登记</div>
          )}
        </div>
        <aside className="processing-provenance">
          <span>处理溯源</span>
          <dl>
            <div>
              <dt>处理运行</dt>
              <dd>{selected.processingRunId}</dd>
            </div>
            <div>
              <dt>数据快照</dt>
              <dd>{selected.snapshotId}</dd>
            </div>
            <div>
              <dt>指标产物</dt>
              <dd>{selected.metricsArtifactId}</dd>
            </div>
            <div>
              <dt>图表产物</dt>
              <dd>{selected.figureArtifactId}</dd>
            </div>
            <div>
              <dt>背景对照</dt>
              <dd>{selected.baselineCaseLabel ?? '没有同活动区背景窗口'}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {selected.limitations.length > 0 && (
        <div className="processing-limitations">
          <strong>本轮不能越过的边界</strong>
          <ul>
            {selected.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
