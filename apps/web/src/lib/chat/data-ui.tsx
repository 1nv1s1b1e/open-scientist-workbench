/**
 * 自定义事件渲染器（data parts）。
 *
 * 后端 custom 事件的 kind（见 lib/types/sse-events.ts CustomEventKind）：
 *   - steering-injected: 用户插话注入
 *   - round-transition: 轮次切换
 *   - convergence: 收敛检测
 *
 * 在 to-thread-messages.ts 中映射为 `data-{kind}` part，
 * 这里用 makeAssistantDataUI 注册渲染器。
 */

'use client'

import { makeAssistantDataUI } from '@assistant-ui/react'
import { GitBranch, Radio, Target } from 'lucide-react'

/** steering-injected: 用户插话 */
export const SteeringInjectedUI = makeAssistantDataUI({
  name: 'steering-injected',
  render: () => (
    <div className="my-1 flex items-center gap-2 rounded-sm border border-blue-500/30 bg-blue-500/5 px-3 py-2">
      <Radio className="h-3.5 w-3.5 text-blue-400" />
      <span className="font-mono text-[12px] uppercase tracking-[1.2px] text-blue-300">
        steering injected
      </span>
    </div>
  ),
})

/** round-transition: 轮次切换 */
export const RoundTransitionUI = makeAssistantDataUI({
  name: 'round-transition',
  render: () => (
    <div className="my-2 flex items-center gap-2">
      <div className="h-px flex-1 bg-[var(--color-border)]" />
      <GitBranch className="h-3.5 w-3.5 text-[var(--color-sunset)]" />
      <span className="font-mono text-[11px] uppercase tracking-[1.4px] text-[var(--color-sunset)]">
        round transition
      </span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  ),
})

/** convergence: 收敛 */
export const ConvergenceUI = makeAssistantDataUI({
  name: 'convergence',
  render: () => (
    <div className="my-1 flex items-center gap-2 rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
      <Target className="h-3.5 w-3.5 text-emerald-400" />
      <span className="font-mono text-[12px] uppercase tracking-[1.2px] text-emerald-300">
        convergence detected
      </span>
    </div>
  ),
})

/** 挂载所有 data UI（在 provider 树内使用一次） */
export function WorkflowDataUIs() {
  return (
    <>
      <SteeringInjectedUI />
      <RoundTransitionUI />
      <ConvergenceUI />
    </>
  )
}
