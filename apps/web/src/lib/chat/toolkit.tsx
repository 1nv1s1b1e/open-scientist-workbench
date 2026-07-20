/**
 * Workflow tool 渲染器。
 *
 * 用 makeAssistantToolUI 为每个 workflow tool 注册自定义 React 渲染器。
 * 在 AssistantRuntimeProvider 树内挂载即可生效。
 *
 * 后端工具名来自 packages/agents/src/<role>/agent.ts 的 tool() 定义。
 * 当前已知工具名（从 packages/tools/src/index.ts 导出）：
 *   - bash-tool（Explore）
 *   - helix-query（Librarian）
 *   - fits-align（Looker）
 *   - mhd-config（Prometheus）
 *   - load-skill（Skills）
 *   - 以及 agent 内联定义的工具（librarian-generate / explore-eval / oracle-critique 等）
 *
 * 未知工具名 fallback 到 ToolFallback（显示 toolName + input/output JSON）。
 */

'use client'

import { makeAssistantToolUI, type ToolCallMessagePartProps } from '@assistant-ui/react'
import { FileSearch, FlaskConical, Hammer, Search, Terminal, Wrench } from 'lucide-react'

/** 通用工具渲染 props（简化版，只取需要的字段） */
type ToolProps = ToolCallMessagePartProps<Record<string, unknown>, unknown>

/** 工具卡片外壳 */
function ToolShell({
  icon,
  name,
  badge,
  status,
  children,
}: {
  icon: React.ReactNode
  name: string
  badge?: string
  status: string
  children?: React.ReactNode
}) {
  const isRunning = status === 'running' || status === 'streaming'
  return (
    <div className="my-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-[var(--color-surface)]">
          {icon}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[1.2px] text-body">{name}</span>
        {badge && (
          <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted">{badge}</span>
        )}
        {isRunning && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-[var(--color-sunset)]">
            running…
          </span>
        )}
      </div>
      {children && <div className="mt-2 space-y-1.5">{children}</div>}
    </div>
  )
}

/** JSON 预览（折叠） */
function JsonPreview({ label, data }: { label: string; data: unknown }) {
  if (data == null) return null
  return (
    <details className="group">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[1px] text-muted transition-colors hover:text-body">
        {label}
      </summary>
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-[var(--color-surface)] p-2 text-[11px] leading-relaxed text-muted">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}

// ── bash-tool (Explore) ──────────────────────────────────────────────────
export const BashToolUI = makeAssistantToolUI({
  toolName: 'bash-tool',
  render: ({ args, result, status }: ToolProps) => (
    <ToolShell
      icon={<Terminal className="h-3.5 w-3.5 text-[var(--color-explore)]" />}
      name="bash"
      badge="Explore"
      status={status.type}
    >
      {args?.command && (
        <pre className="rounded-sm bg-[var(--color-surface)] p-2 text-[11px] text-emerald-300">
          $ {String(args.command).slice(0, 200)}
        </pre>
      )}
      <JsonPreview label="output" data={result} />
    </ToolShell>
  ),
})

// ── helix-query (Librarian) ──────────────────────────────────────────────
export const HelixQueryToolUI = makeAssistantToolUI({
  toolName: 'helix-query',
  render: ({ args, result, status }: ToolProps) => (
    <ToolShell
      icon={<Search className="h-3.5 w-3.5 text-[var(--color-librarian)]" />}
      name="helix-query"
      badge="Librarian"
      status={status.type}
    >
      {args?.query && (
        <p className="font-mono text-[11px] text-muted">
          query: {String(args.query).slice(0, 120)}
        </p>
      )}
      <JsonPreview label="results" data={result} />
    </ToolShell>
  ),
})

// ── fits-align (Looker) ──────────────────────────────────────────────────
export const FitsAlignToolUI = makeAssistantToolUI({
  toolName: 'fits-align',
  render: ({ args, result, status }: ToolProps) => (
    <ToolShell
      icon={<FileSearch className="h-3.5 w-3.5 text-[var(--color-looker)]" />}
      name="fits-align"
      badge="Looker"
      status={status.type}
    >
      <JsonPreview label="input" data={args} />
      <JsonPreview label="alignment" data={result} />
    </ToolShell>
  ),
})

// ── mhd-config (Prometheus) ──────────────────────────────────────────────
export const MhdConfigToolUI = makeAssistantToolUI({
  toolName: 'mhd-config',
  render: ({ result, status }: ToolProps) => (
    <ToolShell
      icon={<FlaskConical className="h-3.5 w-3.5 text-[var(--color-prometheus)]" />}
      name="mhd-config"
      badge="Prometheus"
      status={status.type}
    >
      <JsonPreview label="config" data={result} />
    </ToolShell>
  ),
})

// ── load-skill (Skills) ──────────────────────────────────────────────────
export const LoadSkillToolUI = makeAssistantToolUI({
  toolName: 'load-skill',
  render: ({ args, result, status }: ToolProps) => (
    <ToolShell
      icon={<Wrench className="h-3.5 w-3.5 text-[var(--color-sunset)]" />}
      name="load-skill"
      status={status.type}
    >
      {args?.skill && (
        <p className="font-mono text-[11px] text-muted">skill: {String(args.skill)}</p>
      )}
      <JsonPreview label="output" data={result} />
    </ToolShell>
  ),
})

// ── Generic fallback for unknown tools ───────────────────────────────────
export const GenericToolUI = makeAssistantToolUI({
  toolName: '*',
  render: ({ toolName, args, result, status, isError }: ToolProps) => (
    <ToolShell
      icon={<Hammer className="h-3.5 w-3.5 text-muted" />}
      name={toolName ?? 'tool'}
      status={status.type}
    >
      {isError && <p className="font-mono text-[11px] text-red-400">tool execution error</p>}
      <JsonPreview label="input" data={args} />
      <JsonPreview label="output" data={result} />
    </ToolShell>
  ),
})

/** 挂载所有 tool UI（在 provider 树内使用一次） */
export function WorkflowToolUIs() {
  return (
    <>
      <BashToolUI />
      <HelixQueryToolUI />
      <FitsAlignToolUI />
      <MhdConfigToolUI />
      <LoadSkillToolUI />
      <GenericToolUI />
    </>
  )
}

// 导出供其他地方用
export { Database } from 'lucide-react'
