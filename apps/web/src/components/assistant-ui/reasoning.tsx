/**
 * Reasoning — 推理过程 part 渲染器（可折叠）。
 *
 * 接收 reasoning part 的 text + status（running/complete）。
 * running 时自动展开并显示「思考中…」指示。
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
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
      >
        <ChevronRight
          className={`h-3 w-3 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
          reasoning
        </span>
        {isRunning && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-[var(--color-sunset)]">
            thinking…
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
