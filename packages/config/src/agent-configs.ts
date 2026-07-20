import type { CredentialStore, McpServerConfig } from '@open-scientist/schema'
import type { AgentRole } from './constants.ts'
import { type ModelArg, resolveModelArg } from './models.ts'
import { getSettings } from './settings.ts'

/**
 * Resolved per-agent runtime config —— plain serializable object that can
 * cross the workflow structured-clone boundary. Each of the 6 agents gets
 * one of these in `TournamentWorkflowInput.agentConfigs[role]`.
 *
 * - `modelConfig` is always present (resolved from settings.models[role]
 *   with fallback to `default` → `sisyphus`).
 * - `instructions` / `skillDirectories` / `mcpServers` are `undefined` when
 *   not configured, in which case the agent factory applies its own
 *   hardcoded default.
 */
export interface AgentRuntimeConfig {
  modelConfig: ModelArg
  instructions?: string
  skillDirectories?: string[]
  mcpServers?: McpServerConfig[]
}

const TOURNAMENT_ROLES: AgentRole[] = [
  'sisyphus',
  'librarian',
  'looker',
  'explore',
  'oracle',
  'prometheus',
]

/**
 * Resolve a {@link AgentRuntimeConfig} map for every tournament agent role.
 *
 * Resolution per role:
 * - `modelConfig`: `resolveModelArg(projectName, credentials, {role})`. The
 *   underlying `resolveModelArg` falls back `settings.models[role]` →
 *   `settings.models.default`, so if only `default` (or `sisyphus`) is
 *   configured every sub-agent inherits it.
 * - `instructions`: `settings.agents[role]?.instructions` (undefined →
 *   factory default).
 * - `skillDirectories`: `settings.agents[role]?.skillDirectories`
 *   (undefined → factory default `DEFAULT_SKILLS_DIR`).
 * - `mcpServers`: `settings.agents[role]?.mcpServers` (undefined → `[]`).
 *
 * If `resolveModelArg` throws for a role (no model configured), this
 * function re-throws — callers (e.g. `POST /runs`) should surface a 400.
 */
export async function resolveAgentConfigs(
  projectName: string | undefined,
  credentials: CredentialStore,
): Promise<Record<AgentRole, AgentRuntimeConfig>> {
  const settings = await getSettings(projectName)
  const configs = {} as Record<AgentRole, AgentRuntimeConfig>
  await Promise.all(
    TOURNAMENT_ROLES.map(async (role) => {
      const modelConfig = await resolveModelArg(projectName, credentials, { role })
      const agentCfg = settings.agents?.[role]
      configs[role] = {
        modelConfig,
        ...(agentCfg?.instructions !== undefined ? { instructions: agentCfg.instructions } : {}),
        ...(agentCfg?.skillDirectories !== undefined
          ? { skillDirectories: agentCfg.skillDirectories }
          : {}),
        ...(agentCfg?.mcpServers !== undefined ? { mcpServers: agentCfg.mcpServers } : {}),
      }
    }),
  )
  return configs
}
