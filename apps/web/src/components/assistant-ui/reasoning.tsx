/**
 * Reasoning — 面向用户的模型工作摘要渲染器（可折叠）。
 *
 * 接收 reasoning part 的 text + status（running/complete）。
 * 这里只展示模型提交的公开依据摘要，不把内部隐藏思维链冒充为可审计结论。
 */

'use client'

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { MarkdownText } from './markdown-text'

interface ReasoningProps {
  text: string
  isRunning?: boolean
}

export function Reasoning({ text, isRunning = false }: ReasoningProps) {
  const [open, setOpen] = useState(Boolean(text))
  return (
    <div className="model-work-summary my-1.5 overflow-hidden rounded-lg border border-cyan-200/15 bg-cyan-200/[0.035]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
      >
        <ChevronRight
          className={`h-3 w-3 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-cyan-100/70">
          模型工作摘要
        </span>
        {isRunning && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-[var(--color-sunset)]">
            生成中…
          </span>
        )}
      </button>
      {(open || isRunning) && text && (
        <div className="border-t border-[var(--color-border)] px-3 py-2.5">
          <MarkdownText text={text} />
        </div>
      )}
    </div>
  )
}
