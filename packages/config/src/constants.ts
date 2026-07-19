export const MAX_ROUNDS = 10
export const TARGET_F1 = 0.9
export const CONVERGENCE_WINDOW = 3
export const CONVERGENCE_THRESHOLD = 0.005
export const MAX_CONCURRENT_RUNS = 4
export const WORKFLOW_STEP_RETRIES = 3

export const DEFAULT_THINKING_LEVEL = 'medium' as const

export const AGENT_ROLES = [
  'default',
  'sisyphus',
  'librarian',
  'looker',
  'explore',
  'oracle',
  'prometheus',
] as const

export type AgentRole = (typeof AGENT_ROLES)[number]
