// These mirror the Zod defaults in @open-scientist/schema
// TournamentSettingsSchema — the schema is the canonical source of truth.
export const MAX_ROUNDS = 10
export const TARGET_F1 = 0.9

export const DEFAULT_THINKING_LEVEL = 'medium' as const

export type AgentRole =
  | 'default'
  | 'sisyphus'
  | 'librarian'
  | 'looker'
  | 'explore'
  | 'oracle'
  | 'prometheus'
