'use client'

import { AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { ArrowUp, Bot, Flame, Square, User } from 'lucide-react'
import { MarkdownText } from './markdown-text'
import { Reasoning } from './reasoning'
import { ToolFallback } from './tool-fallback'

const SUGGESTED_PHENOMENA = [
  {
    title: '活动区多波段不同步增亮',
    prompt: '某活动区在一段观测窗口内出现局部增亮和升温，不同 EUV 波段的响应存在时间差，暂时无法判断主要加热机制。',
  },
  {
    title: '短时升温与间歇性爆发',
    prompt: '某活动区在持续升温的背景上叠加多次短时亮度突增，同时出现局部结构变化，需要区分连续波动耗散和间歇性释放。',
  },
  {
    title: '热结构与磁场变化不同步',
    prompt: '同一活动区的温度演化与磁场拓扑变化没有明显同步关系，需要进一步检索多波段观测和数值模拟进行核验。',
  },
]

function UserMessage() {
  return (
    <MessagePrimitive.Root className="my-3 flex justify-end px-1">
      <div className="flex max-w-[92%] items-start gap-2.5">
        <div className="conversation-bubble conversation-user">
          <div className="mb-1 flex items-center gap-2 border-b border-white/10 pb-1.5">
            <User className="h-3.5 w-3.5 text-white/70" />
            <span className="font-mono text-[10px] tracking-[1px] text-white/65">现象输入</span>
          </div>
          <MessagePrimitive.Parts components={{ Text: ({ text }) => <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">{text}</p> }} />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="my-3 flex justify-start px-1">
      <div className="flex max-w-[94%] items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[var(--color-surface)] text-white">
          <Bot className="h-4 w-4 text-[var(--color-sunset)]" />
        </div>
        <div className="conversation-bubble conversation-assistant min-w-0 flex-1">
          <MessagePrimitive.Parts
            components={{
              Text: ({ text }) => <MarkdownText text={text} />,
              Reasoning: ({ text, status }) => <Reasoning text={text} isRunning={status?.type === 'running'} />,
              tools: {
                Fallback: (props) => <ToolFallback toolName={props.toolName} args={props.args} result={props.result} status={props.status} isError={props.isError} />,
              },
            }}
          />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

function ThreadEmpty({ showComposer }: { showComposer: boolean }) {
  const handleSelectPhenomenon = (phenomenonText: string) => {
    const textarea = document.querySelector('textarea')
    if (textarea) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (descriptor?.set) descriptor.set.call(textarea, phenomenonText)
      else textarea.value = phenomenonText
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  return (
    <div className="console-empty">
      <div className="console-empty-mark"><Flame className="h-4 w-4" /></div>
      <div className="eyebrow-mono mt-4 text-[var(--color-sunset-soft)]">RUN LOG</div>
      <h3 className="mt-2 text-xl font-medium tracking-[-0.02em] text-white">暂无运行记录</h3>
      <p className="mt-2 max-w-xs text-center text-xs leading-5 text-[var(--color-text-muted)]">在左侧现象面板提交分析后，本轮 agent 输出会按轮次显示在这里。</p>

      {showComposer && <details className="console-example-list">
        <summary>查看现象示例</summary>
        <div className="mt-2 space-y-2">
          {SUGGESTED_PHENOMENA.map((item) => <button key={item.title} type="button" onClick={() => handleSelectPhenomenon(item.prompt)} className="console-example-item"><span>{item.title}</span><span className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-muted)]">{item.prompt}</span></button>)}
        </div>
      </details>}
    </div>
  )
}

function ThreadComposer() {
  return (
    <ComposerPrimitive.Root className="console-composer">
      <ComposerPrimitive.Input aria-label="现象或问题输入" placeholder="补充一个活动区现象、问题，或本轮需要核验的内容…" className="min-h-[68px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 font-sans text-sm text-body placeholder:text-muted focus:outline-none" rows={3} />
      <div className="flex items-center justify-between border-t border-[var(--color-border)]/60 px-3.5 py-2.5">
        <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-sunset)]" /><span className="font-mono text-[10px] tracking-[.06em] text-muted">自然语言输入</span></div>
        <div className="flex items-center gap-2">
          <AuiIf condition={(s) => s.thread.isRunning}><ComposerPrimitive.Cancel aria-label="停止运行" className="flex h-8 w-8 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"><Square className="h-3.5 w-3.5" /></ComposerPrimitive.Cancel></AuiIf>
          <AuiIf condition={(s) => !s.thread.isRunning}><ComposerPrimitive.Send aria-label="提交现象" className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 hover:bg-[#fafaf7] disabled:opacity-30"><ArrowUp className="h-4 w-4" /></ComposerPrimitive.Send></AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  )
}

export function Thread({ showComposer = true }: { showComposer?: boolean }) {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
      <ThreadPrimitive.Viewport className="console-thread-viewport flex-1 overflow-y-auto px-3 py-3">
        <ThreadPrimitive.Empty><ThreadEmpty showComposer={showComposer} /></ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ThreadPrimitive.Viewport>
      {showComposer && <div className="console-composer-wrap"><ThreadComposer /></div>}
    </ThreadPrimitive.Root>
  )
}
