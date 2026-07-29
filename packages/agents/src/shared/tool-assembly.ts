/**
 * Shared toolset assembly for the 6 agent roles.
 *
 * All 5 specialist agents (librarian / looker / explore / oracle / prometheus)
 * assemble their default toolset with the same shape:
 *
 *   1. Resolve skill directories (default → `DEFAULT_SKILLS_DIR`).
 *   2. Create a bash toolkit bound to a workspace slot.
 *   3. Discover skills + build the `loadSkill` tool.
 *   4. Merge domain-specific `extraTools`.
 *   5. Merge MCP server tools (if any).
 *
 * Only two things vary per role:
 *   - the workspace slot name (`__librarian__` / `__oracle__` / `prometheus` /
 *     a hypothesis id),
 *   - which domain tools merge in (searchPapers, mhdConfig, fitsAlign, …).
 *
 * This helper concentrates that shape so the MCP-merge `Object.assign` collision
 * bug (MCP tools silently overwriting base tools on name clash) is fixed in one
 * place, and the skill-discovery + bash-toolkit wiring is not duplicated 5×.
 *
 * Sisyphus is the exception: it has no bash tool and no skills, only the
 * `review_leading_hypothesis` tool + optional MCP merge. Pass
 * `workspaceSlot: undefined` (or omit it) to skip bash/skill assembly — the
 * caller supplies its sole tool via `extraTools`.
 */
import { getMcpTools } from '@open-scientist/mcp'
import type { McpServerConfig } from '@open-scientist/schema'
import { createSkillToolkit, DEFAULT_SKILLS_DIR } from '@open-scientist/skills'
import { createBashToolForHypothesis } from '@open-scientist/tools'
import { createLogger } from '@open-scientist/logger'
import type { ToolSet } from 'ai'

const logger = createLogger('agents')

export interface AssembleDefaultToolsOptions {
  /** Project name — drives workspace dir isolation. */
  projectId: string
  /** Run identifier — used for workspace dir isolation. */
  runId: string
  /**
   * Workspace slot name. When omitted (Sisyphus), no bash / readFile /
   * writeFile / loadSkill tools are assembled — the caller supplies its own
   * `extraTools`.
   */
  workspaceSlot?: string
  /**
   * Domain-specific tools to merge into the base toolset (e.g.
   * `{searchPapers, searchHypotheses, addHypothesis}` for Librarian,
   * `{mhdConfig}` for Prometheus). These are merged BEFORE MCP tools so MCP
   * tools cannot silently overwrite them (see `mergeMcpTools`).
   */
  extraTools?: ToolSet
  /**
   * Optional skill discovery directories. When omitted,
   * `DEFAULT_SKILLS_DIR` from `@open-scientist/skills` is used.
   */
  skillDirectories?: string[]
  /**
   * Optional MCP server list. Tools from each server are fetched via
   * `getMcpTools` and merged into the toolset. Name collisions between an
   * MCP tool and an existing tool are logged at warn level (the MCP tool
   * overwrites — preserving prior behaviour — but the collision is now
   * visible instead of silent).
   */
  mcpServers?: McpServerConfig[]
}

/**
 * Assemble the default toolset shared across the 5 specialist agents.
 *
 * When `workspaceSlot` is omitted (Sisyphus), only `extraTools` + MCP tools
 * are assembled — no bash / readFile / writeFile / loadSkill.
 */
export async function assembleDefaultTools({
  projectId,
  runId,
  workspaceSlot,
  extraTools,
  skillDirectories,
  mcpServers,
}: AssembleDefaultToolsOptions): Promise<ToolSet> {
  const dirs = skillDirectories ?? [DEFAULT_SKILLS_DIR]

  const baseTools: ToolSet = { ...extraTools }

  if (workspaceSlot !== undefined) {
    logger.debug(
      { projectId, runId, workspaceSlot, dirs },
      'assembleDefaultTools: creating bash tool',
    )
    const bashToolkit = await createBashToolForHypothesis(projectId, runId, workspaceSlot)
    logger.debug('assembleDefaultTools: bash tool created, discovering skills')
    const { loadSkillTool } = await createSkillToolkit(dirs)
    logger.debug('assembleDefaultTools: skills discovered')

    Object.assign(baseTools, {
      bash: bashToolkit.tools.bash,
      readFile: bashToolkit.tools.readFile,
      writeFile: bashToolkit.tools.writeFile,
      loadSkill: loadSkillTool,
    })
  }

  await mergeMcpTools(projectId, baseTools, mcpServers)
  return baseTools
}

/**
 * Merge tools from each MCP server into `tools`. Name collisions between an
 * MCP tool and an existing tool are logged at warn level — the MCP tool
 * overwrites (preserving prior `Object.assign` behaviour), but the collision
 * is now visible instead of silent.
 *
 * `projectName` scopes MCP server connections per-project.
 *
 * Exported so Sisyphus (which bypasses `assembleDefaultTools` but still needs
 * MCP merge) can reuse the same collision-aware merge.
 */
export async function mergeMcpTools(
  projectId: string,
  tools: ToolSet,
  mcpServers?: McpServerConfig[],
): Promise<void> {
  if (!mcpServers || mcpServers.length === 0) return
  for (const server of mcpServers) {
    const mcpTools = await getMcpTools(projectId, server)
    for (const name of Object.keys(mcpTools)) {
      if (name in tools) {
        logger.warn(
          { serverName: server.name, toolName: name },
          'mergeMcpTools: MCP tool overwrites existing tool of the same name',
        )
      }
    }
    Object.assign(tools, mcpTools)
  }
}
