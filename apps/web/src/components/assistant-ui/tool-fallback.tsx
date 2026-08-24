/**
 * ToolFallback — 未注册工具的兜底渲染器。
 *
 * 显示 toolName + args/result JSON（折叠）。
 * 内部 submit_result 工具隐藏，避免混淆对话框。
 */

'use client'

import { Hammer } from 'lucide-react'

interface ToolFallbackProps {
  toolName?: string
  args?: unknown
  result?: unknown
  status?: { type: string }
  isError?: boolean
}

export function ToolFallback({ toolName, args, result, status, isError }: ToolFallbackProps) {
  // 隐藏内部的 submit_result 结果提交工具
  if (toolName === 'submit_result' || toolName === 'submit-result') {
    return null
  }

  const isRunning = status?.type === 'running'
  return (
    <div className="my-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-[var(--color-surface)]">
          <Hammer className="h-3.5 w-3.5 text-muted" />
        </span>
        <span className="font-mono text-[12px] uppercase tracking-[1.2px] text-body">
          {toolName ?? 'tool'}
        </span>
        {isRunning && (
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[1px] text-[var(--color-sunset)]">
            running…
          </span>
        )}
      </div>
      {isError && <p className="mt-2 font-mono text-[12px] text-red-400">tool execution error</p>}
      {args != null && (
        <details className="mt-2 group">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[1px] text-muted transition-colors hover:text-body">
            input
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-[var(--color-surface)] p-2 text-[12px] leading-relaxed text-muted">
            {JSON.stringify(args, null, 2)}
          </pre>
        </details>
      )}
      {result != null && (
        <details className="mt-1.5 group">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[1px] text-muted transition-colors hover:text-body">
            output
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-[var(--color-surface)] p-2 text-[12px] leading-relaxed text-muted">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
