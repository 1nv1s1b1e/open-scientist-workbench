'use client'

import type { PhenomenonInput } from '@open-scientist/schema'
import { ArrowRight, Check, Edit3, MessageSquareText, Radio, ScanSearch, Square } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

interface PhenomenonDraft {
  narrative: string
  question: string
}

const EMPTY_DRAFT: PhenomenonDraft = { narrative: '', question: '' }

function makeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
}

function draftToPhenomenon(draft: PhenomenonDraft): PhenomenonInput | undefined {
  const narrative = draft.narrative.trim()
  if (!narrative) return undefined
  const title = (narrative.split(/[。！？.!?\n]/)[0] ?? narrative).trim().slice(0, 64) || '活动区现象'
  return {
    phenomenonId: `phenomenon-${makeSlug(narrative).slice(0, 42) || 'input'}`,
    title,
    description: narrative,
    observations: [],
    ...(draft.question.trim() ? { requestedQuestion: draft.question.trim() } : {}),
    constraints: [],
  }
}

type PhenomenonValue = Pick<PhenomenonInput, 'description' | 'requestedQuestion'>

export function PhenomenonPanel({
  value,
  onChange,
  onSubmit,
  onStop,
  isSubmitting = false,
}: {
  value: PhenomenonValue | undefined
  onChange: (value: PhenomenonInput | undefined) => void
  onSubmit?: () => void
  onStop?: () => void
  isSubmitting?: boolean
}) {
  const [draft, setDraft] = useState<PhenomenonDraft>(() => value ? { narrative: value.description, question: value.requestedQuestion ?? '' } : EMPTY_DRAFT)
  const [editing, setEditing] = useState(() => !value?.description)

  useEffect(() => {
    if (!value) {
      setDraft(EMPTY_DRAFT)
      setEditing(true)
      return
    }
    setDraft({ narrative: value.description, question: value.requestedQuestion ?? '' })
  }, [value])

  const update = (key: keyof PhenomenonDraft, next: string) => {
    const nextDraft = { ...draft, [key]: next }
    setDraft(nextDraft)
    onChange(draftToPhenomenon(nextDraft))
  }

  const ready = Boolean(draftToPhenomenon(draft))
  const submit = () => {
    if (!ready || isSubmitting) return
    setEditing(false)
    onSubmit?.()
  }

  return (
    <section className={`workbench-panel phenomenon-panel ${editing ? 'phenomenon-panel-editing' : ''}`}>
      <div className="workbench-panel-header">
        <div className="flex items-center gap-3"><div className="icon-orbit"><ScanSearch className="h-4 w-4" /></div><div><div className="eyebrow-mono text-[var(--color-breeze)]">本次分析输入</div><h2 className="mt-1 text-base font-medium text-white">{editing ? '记录真实观测或模拟现象' : '已登记的科学现象'}</h2></div></div>
        {editing ? <motion.div animate={{ opacity: ready ? 1 : .55, scale: ready ? 1 : .98 }} className={ready ? 'status-chip status-chip-success' : 'status-chip'}>{ready ? <Check className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}{ready ? '可以分析' : '等待输入'}</motion.div> : <button type="button" onClick={() => setEditing(true)} className="phenomenon-edit-button"><Edit3 className="h-3.5 w-3.5" />修改</button>}
      </div>

      {editing ? (
        <div className="space-y-3 p-4">
          <label className="block"><span>现象原文</span><textarea value={draft.narrative} onChange={(event) => update('narrative', event.target.value)} placeholder="例如：某活动区出现持续升温、局部亮度突增，不同波段响应存在时间差。" rows={5} /></label>
          <label className="block"><span>关注问题（可选）</span><div className="relative"><MessageSquareText className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" /><input className="pl-9" value={draft.question} onChange={(event) => update('question', event.target.value)} placeholder="例如：哪组观测最能区分两种机制？" /></div></label>
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
            <div className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-[var(--color-text-muted)]"><ScanSearch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-breeze)]" /><span>只需描述现象；资料、证据与反例会在分析过程中由各阶段逐步登记。</span></div>
            {isSubmitting && onStop
              ? <button type="button" onClick={onStop} className="workbench-stop-button"><Square className="h-3.5 w-3.5" />停止分析</button>
              : onSubmit && <button type="button" onClick={submit} disabled={!ready} className="workbench-submit-button"><ArrowRight className="h-3.5 w-3.5" />开始分析</button>}
          </div>
        </div>
      ) : (
        <div className="phenomenon-summary-content">
          <div className="phenomenon-field-label">现象原文</div><p>{draft.narrative}</p>
          {draft.question && <div className="phenomenon-question"><MessageSquareText className="h-3.5 w-3.5" /><div><small>关注问题</small><span>{draft.question}</span></div></div>}
          <div className="phenomenon-summary-footer"><span>{isSubmitting ? '正在处理本轮科学任务' : '输入已准备好'}</span>{isSubmitting && onStop
            ? <button type="button" onClick={onStop} className="workbench-stop-button"><Square className="h-3.5 w-3.5" />停止分析</button>
            : onSubmit && <button type="button" onClick={submit} className="workbench-submit-button"><ArrowRight className="h-3.5 w-3.5" />重新开始分析</button>}</div>
        </div>
      )}
    </section>
  )
}
