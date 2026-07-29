/**
 * SSE 事件类型 — 对应后端 UIMessageChunk（@ai-sdk/workflow 的 createModelCallToUIChunkTransform）。
 *
 * 契约来源：docs/web/05-api-contracts.md §8 + apps/api/src/routes/runs.ts 实测。
 * 所有事件格式：`data: <JSON>\n\n`，流结束发送 `data: [DONE]\n\n`。
 */

// 生命周期
export type LifecycleChunk =
  | { type: 'start'; messageId?: string; messageMetadata?: unknown }
  | { type: 'start-step' }
  | { type: 'finish-step' }
  | { type: 'finish'; finishReason?: string; messageMetadata?: unknown }
  | { type: 'abort'; reason?: string }
  | { type: 'error'; errorText: string }

// 文本
export type TextChunk =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }

// Reasoning (thinking)
export type ReasoningChunk =
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }

// Tool 调用
export type ToolChunk =
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | {
      type: 'tool-input-available'
      toolCallId: string
      toolName: string
      input: unknown
    }
  | { type: 'tool-output-available'; toolCallId: string; output: unknown }
  | {
      type: 'tool-input-error'
      toolCallId: string
      toolName: string
      input: unknown
      errorText: string
    }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string }

// 审批（人机协同，当前后端未启用，但 schema 已定义）
export type ApprovalChunk =
  | {
      type: 'tool-approval-request'
      approvalId: string
      toolCallId: string
      isAutomatic?: boolean
      signature?: string
    }
  | { type: 'tool-approval-response'; approvalId: string; approved: boolean; reason?: string }

// 其他
export type MiscChunk =
  | { type: 'source-url'; sourceId: string; url: string; title?: string }
  | {
      type: 'source-document'
      sourceId: string
      mediaType: string
      title: string
      filename?: string
    }
  | { type: 'file'; url: string; mediaType: string }
  | { type: 'message-metadata'; messageMetadata: unknown }
  | { type: 'custom'; kind: string; [key: string]: unknown }

export type UIMessageChunk =
  | LifecycleChunk
  | TextChunk
  | ReasoningChunk
  | ToolChunk
  | ApprovalChunk
  | MiscChunk

/** 自定义事件 kind 命名空间（custom 事件的 kind 字段） */
export const CustomEventKind = {
  SteeringInjected: 'steering-injected',
  RoundTransition: 'round-transition',
  Convergence: 'convergence',
  AgentState: 'tournament.agent-state',
  RoundUpdate: 'tournament.round-update',
  PhaseStart: 'tournament.phase-start',
} as const

/** Round-update custom chunk payload (emitted after Explore + Oracle phases) */
export interface RoundUpdatePayload {
  type: 'custom'
  kind: typeof CustomEventKind.RoundUpdate
  round: number
  hypotheses: Array<{
    id: string
    statement: string
    parentId: string | null
    round: number
    f1: number | null
    status: string
    createdAt: string
  }>
  convergenceHistory: Array<{ round: number; bestF1: number; count: number }>
}
