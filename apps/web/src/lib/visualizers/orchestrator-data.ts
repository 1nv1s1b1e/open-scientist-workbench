/**
 * agent 实时状态 → React Flow 节点/边数据转换。
 *
 * 数据来源：SSE 流中的 tool-input-start / tool-output-available 事件，
 * 提取 toolName（如 call_librarian）→ agent role 映射。
 */

import type {
  AgentRole,
  AgentState,
  MessageEdgeData,
  MessageEdgeKind,
  OrchestratorData,
} from '@/lib/types/visualizers'
import { AGENT_ROLES } from './colorTheme.ts'

/** 后端 tool name → agent role 映射（对应 6 个子 agent 的 call tool） */
export const TOOL_TO_AGENT: Record<string, AgentRole> = {
  call_librarian: 'librarian',
  call_looker: 'looker',
  call_explore: 'explore',
  call_oracle: 'oracle',
  call_prometheus: 'prometheus',
  // Sisyphus 是编排器，不直接 call tool，通过 start-step / 路由事件推断
}

/** 协作大厅环形布局坐标（6 agent） */
export const AGENT_POSITIONS: Record<AgentRole, { x: number; y: number }> = {
  sisyphus: { x: 0, y: -200 },
  prometheus: { x: 173, y: -100 },
  oracle: { x: 173, y: 100 },
  explore: { x: 0, y: 200 },
  looker: { x: -173, y: 100 },
  librarian: { x: -173, y: -100 },
}

/** 初始空状态：6 agent 全 idle */
export function buildInitialOrchestratorData(): OrchestratorData {
  return {
    agents: AGENT_ROLES.map((role) => ({
      role,
      label: role.charAt(0).toUpperCase() + role.slice(1),
      state: 'idle' as AgentState,
    })),
    edges: [],
  }
}

/** 根据当前活跃 agent 推断协作边（POC：Sisyphus ↔ 活跃 agent 双向） */
export function deriveEdges(
  activeAgent: AgentRole | null,
  lastKind: MessageEdgeKind | null,
  label?: string,
): MessageEdgeData[] {
  if (!activeAgent || activeAgent === 'sisyphus') return []
  return [
    {
      source: 'sisyphus',
      target: activeAgent,
      kind: lastKind ?? 'collab',
      active: true,
      label,
    },
  ]
}
