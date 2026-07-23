/**
 * Thread — 主对话线程组件，基于 ThreadPrimitive 自建。
 *
 * xAI Aesthetic: near-black canvas, white-outline pills, Inter + Geist Mono,
 * sleek micro-animations, quick prompt chips, high contrast markdown.
 */

'use client'

import { AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { ArrowUp, Bot, Flame, Sparkles, Square, User } from 'lucide-react'
import { MarkdownText } from './markdown-text'
import { Reasoning } from './reasoning'
import { ToolFallback } from './tool-fallback'

/** Quick prompt suggestions */
const SUGGESTED_SEEDS = [
  {
    title: 'Alfvén 波耗散',
    prompt: 'Alfvén 波在日冕等离子体中的耗散主导了日冕加热过程，其能量通量足以弥补日冕辐射损失。',
  },
  {
    title: '纳耀斑磁重联',
    prompt: '小尺度纳耀斑（Nanoflares）磁重联能量释放是日冕维持数百万开氏度高温的核心驱动力。',
  },
  {
    title: '湍流级联机制',
    prompt: '光球层剪切运动驱动湍流级联，将大尺度磁场能量级联至离子回旋辐射与动力学尺度耗散。',
  },
]

/** 用户消息 */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="my-3 flex justify-end">
      <div className="flex max-w-[85%] items-start gap-2.5">
        <div className="rounded-lg border border-white/20 bg-[var(--color-surface-soft)] px-4 py-3 shadow-sm">
          <div className="mb-1 flex items-center gap-2 border-b border-white/10 pb-1.5">
            <User className="h-3.5 w-3.5 text-white/70" />
            <span className="font-mono text-[10px] uppercase tracking-[1.4px] text-white/80">
              User Seed
            </span>
          </div>
          <MessagePrimitive.Parts
            components={{
              Text: ({ text }) => (
                <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">{text}</p>
              ),
            }}
          />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

/** Assistant 消息 */
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="my-3 flex justify-start">
      <div className="flex max-w-[90%] items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[var(--color-surface)] text-white">
          <Bot className="h-4 w-4 text-[var(--color-sunset)]" />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
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
      </div>
    </MessagePrimitive.Root>
  )
}

/** 空状态欢迎屏 */
function ThreadEmpty() {
  const handleSelectSeed = (seedText: string) => {
    const textarea = document.querySelector('textarea')
    if (textarea) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, seedText)
      } else {
        textarea.value = seedText
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  return (
    <div className="my-auto flex flex-col items-center justify-center px-6 py-8 text-center">
      <div className="relative mt-2 mb-4 flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-spin-slow rounded-full border border-white/15" />
        <span className="absolute inset-2 rounded-full border border-white/25" />
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-soft)] shadow-inner">
          <Flame className="h-4 w-4 text-[var(--color-sunset)]" />
        </span>
      </div>

      <h3 className="text-2xl font-normal tracking-tight text-white">Sisyphus Tournament Engine</h3>
      <p className="mt-2.5 max-w-md text-sm leading-relaxed text-body">
        基于 Co-Scientist + AlphaEvolve 演化框架。输入一个假说种子，开启六大 AI 智能体的锦标赛辩论与
        MHD 配置输出。
      </p>

      {/* Suggested quick prompt chips */}
      <div className="mt-8 w-full max-w-md space-y-2.5 text-left">
        <span className="block font-mono text-[10px] uppercase tracking-[1.4px] text-muted">
          Suggested Hypothesis Seeds:
        </span>
        {SUGGESTED_SEEDS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => handleSelectSeed(s.prompt)}
            className="group flex w-full flex-col rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-all hover:border-white/30 hover:bg-[var(--color-surface-soft)]"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-normal text-white group-hover:text-[var(--color-sunset-soft)]">
                {s.title}
              </span>
              <Sparkles className="h-3.5 w-3.5 text-muted transition-colors group-hover:text-white" />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{s.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Composer 输入区 */
function ThreadComposer() {
  return (
    <ComposerPrimitive.Root className="flex w-full flex-col rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors focus-within:border-white/40">
      <ComposerPrimitive.Input
        placeholder="输入日冕加热假说种子（例如：Alfvén 波在日冕等离子体中的耗散主导了加热过程）…"
        className="min-h-[72px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 font-sans text-sm text-body placeholder:text-muted focus:outline-none"
        rows={3}
      />
      <div className="flex items-center justify-between border-t border-[var(--color-border)]/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-sunset)]" />
          <span className="font-mono text-[10px] uppercase tracking-[1.4px] text-muted">
            seed · tournament run
          </span>
        </div>
        <div className="flex items-center gap-2">
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel className="flex h-8 w-8 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20">
              <Square className="h-3.5 w-3.5" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 hover:bg-[#fafaf7] disabled:opacity-30">
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
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-3">
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
      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
        <ThreadComposer />
      </div>
    </ThreadPrimitive.Root>
  )
}
