/**
 * WorkflowChatTransport 配置（见 docs/web/02-architecture.md §Transport 流）。
 *
 * 当前 Phase：POC 阶段，useRunStream 直接消费 SSE 流，不走 assistant-ui runtime。
 * 后续 Phase 集成 assistant-ui 时，此文件提供 WorkflowChatTransport 实例，
 * 配合 useChatRuntime + toolkit 实现 per-tool renderer + approval 三状态。
 *
 * 关键配置（后续启用）：
 *   - api: `/api/runs/${runId}/messages`（POST）
 *   - initialStartIndex: -50（页面刷新只取最后 50 chunks）
 *   - maxConsecutiveErrors: 5
 *   - 断线重连：WorkflowChatTransport 自动检测无 finish 事件 → GET /stream 续传
 *
 * 后端配合：POST /runs 响应 header x-workflow-run-id，前端存 runId 用于重连。
 * 用户按停止按钮 → POST /runs/:id/stop（持久化 partial + cancel workflow）。
 * 路由卸载 → 只 abort fetch，不调 stop，后端继续跑。
 */

export const TRANSPORT_CONFIG = {
  /** 页面刷新时只取最后 50 chunks（见 02-architecture.md） */
  initialStartIndex: -50,
  /** 连续重连失败上限 */
  maxConsecutiveErrors: 5,
  /** throttle 渲染节流（ms），见 02-architecture.md §Throttle */
  throttle: 50,
} as const

/**
 * 构建 run messages endpoint URL。
 * POST /api/projects/:name/runs 是启动端点，SSE 流从 response body 消费。
 * 注意：后端没有 POST /api/runs/:id/messages 端点（与 02-architecture.md 设计不同，
 * 实际实现是 POST /api/projects/:name/runs 直接返回 SSE 流，见 05-api-contracts.md §6）。
 */
export function runStreamUrl(project: string): string {
  return `/api/projects/${encodeURIComponent(project)}/runs`
}

/** 断线重连 URL */
export function runReconnectUrl(project: string, runId: string, startIndex: number = -50): string {
  return `/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}/stream?startIndex=${startIndex}`
}
