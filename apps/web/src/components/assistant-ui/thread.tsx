/**
 * Thread — 主对话线程组件，基于 ThreadPrimitive 自建。
 *
 * 结构：
 *   ThreadPrimitive.Root
 *   ├─ Viewport（可滚动消息列表）
 *   │   ├─ Empty 状态
 *   │   └─ Messages
 *   │       ├─ UserMessage
 *   │       └─ AssistantMessage
 *   │           └─ MessagePrimitive.Parts（逐 part 渲染）
 *   └─ ViewportFooter（Composer 输入区）
 *       └─ ComposerPrimitive.Root
 *           ├─ Input
 *           └─ Send / Cancel（AuiIf 切换）
 *
 * 单轮约束：isSendDisabled 已在 WorkflowRuntimeProvider 设置。
 */

'use client'

import { AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { ArrowUp, Square } from 'lucide-react'
import { MarkdownText } from './markdown-text'
import { Reasoning } from './reasoning'
import { ToolFallback } from './tool-fallback'

/** 用户消息 */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[80%] rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-soft)] px-4 py-2.5">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => (
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-body">{text}</p>
            ),
          }}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

/** Assistant 消息 */
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[85%] rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => <MarkdownText text={text} />,
            Reasoning: ({ text, status }) => (
              <Reasoning text={text} isRunning={status?.type === 'running'} />
            ),
            tools: {
              Fallback: (props) => (
                <ToolFallback
                  toolName={props.toolName}
                  args={props.args}
                  result={props.result}
                  status={props.status}
                  isError={props.isError}
                />
              ),
            },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

/** 空状态欢迎屏 */
function ThreadEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]">
        <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--color-sunset)]" />
      </div>
      <h3 className="text-xl font-normal tracking-tight text-white">Sisyphus Tournament Engine</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
        输入一个日冕加热假说种子，启动六位智能体的演化推理。
      </p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[1.4px] text-muted">
        seed → librarian → explore → oracle → prometheus
      </p>
    </div>
  )
}

/** Composer 输入区 */
function ThreadComposer() {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl flex-col rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-white/30">
      <ComposerPrimitive.Input
        placeholder="例如：Alfvén 波在日冕等离子体中的耗散主导了加热过程…"
        className="min-h-[56px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-body placeholder:text-muted focus:outline-none"
        rows={3}
      />
      <div className="flex items-center justify-between px-3 pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
          seed · single-turn
        </span>
        <div className="flex items-center gap-2">
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel className="flex h-8 w-8 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20">
              <Square className="h-3.5 w-3.5" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-opacity hover:opacity-90 disabled:opacity-30">
              <ArrowUp className="h-4 w-4" />
            </ComposerPrimitive.Send>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  )
}

/** 主 Thread 组件 */
export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
        <ThreadPrimitive.Empty>
          <ThreadEmpty />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <div className="border-t border-[var(--color-border)] p-3">
        <ThreadComposer />
      </div>
    </ThreadPrimitive.Root>
  )
}
