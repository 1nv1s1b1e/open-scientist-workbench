import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import { getMcpTools } from '@open-scientist/mcp'
import { HypothesisPoolSchema, type McpServerConfig } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import {
  addHypothesisTool,
  createBashToolForHypothesis,
  searchHypothesesTool,
  searchPapersTool,
} from '@open-scientist/tools'
import { isStepCount, Output, ToolLoopAgent, type ToolSet } from 'ai'

const logger = createLogger('agents')

export interface LibrarianAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name (used for workspace isolation + HelixDB scoping). */
  projectId: string
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
  /** Optional system prompt override. When omitted, the hardcoded default is used. */
  instructions?: string
  /**
   * Optional skill discovery directories. When omitted, `DEFAULT_SKILLS_DIR`
   * from `@open-scientist/skills` is used. Only consulted when `tools` is
   * not provided.
   */
  skillDirectories?: string[]
  /**
   * Optional MCP server list. Tools from each server are fetched via
   * `getMcpTools` and merged into the default toolset. Only consulted when
   * `tools` is not provided.
   */
  mcpServers?: McpServerConfig[]
  /**
   * Optional runtime context passed to the ToolLoopAgent constructor. Carries
   * serializable identifiers (projectId / runId / round) for telemetry and
   * lineage. Must be plain data (no functions / class instances).
   */
  runtimeContext?: Record<string, unknown>
}

const LIBRARIAN_WORKSPACE_HYPO = '__librarian__'

/**
 * Assemble the default toolset for the Librarian agent.
 *
 * Tools:
 * - `searchPapers` / `searchHypotheses` / `addHypothesis` — HelixDB RAG (from @open-scientist/tools)
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to a shared librarian workspace
 *   (project-scoped, not per-hypothesis; librarian only writes seed Python files)
 * - `loadSkill` — progressive disclosure (loads `solar-physics-rag` SKILL.md)
 *
 * NOTE: This function performs async I/O (HelixDB-agnostic fs scan + bash-tool sandbox
 * init). Call it from an async context before `agent.stream()`.
 */
export async function getDefaultLibrarianTools(
  projectId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  const dirs = skillDirectories ?? [DEFAULT_SKILLS_DIR]
  logger.debug({ projectId, dirs }, 'getDefaultLibrarianTools: creating bash tool')
  const bashToolkit = await createBashToolForHypothesis(projectId, LIBRARIAN_WORKSPACE_HYPO)
  logger.debug('getDefaultLibrarianTools: bash tool created, discovering skills')
  const skills = await discoverSkills(createNodeSandbox(), dirs)
  logger.debug({ skillCount: skills.length }, 'getDefaultLibrarianTools: skills discovered')
  const loadSkillTool = createLoadSkillTool(skills)

  const baseTools: ToolSet = {
    searchPapers: searchPapersTool,
    searchHypotheses: searchHypothesesTool,
    addHypothesis: addHypothesisTool,
    bash: bashToolkit.tools.bash,
    readFile: bashToolkit.tools.readFile,
    writeFile: bashToolkit.tools.writeFile,
    loadSkill: loadSkillTool,
  }
  if (mcpServers && mcpServers.length > 0) {
    for (const server of mcpServers) {
      const mcpTools = await getMcpTools(server)
      Object.assign(baseTools, mcpTools)
    }
  }
  return baseTools
}

export async function createLibrarianAgent({
  modelConfig,
  projectId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
  runtimeContext,
}: LibrarianAgentDeps) {
  logger.debug(
    { provider: modelConfig.provider, model: modelConfig.model },
    'createLibrarianAgent: creating model',
  )
  const model = createModelFromConfig(modelConfig)
  logger.debug('createLibrarianAgent: model created, resolving tools')
  const resolvedTools =
    tools ?? (await getDefaultLibrarianTools(projectId, skillDirectories, mcpServers))
  logger.debug(
    { toolNames: Object.keys(resolvedTools) },
    'createLibrarianAgent: tools resolved, constructing ToolLoopAgent',
  )

  return new ToolLoopAgent({
    id: 'librarian',
    model,
    instructions:
      instructions ??
      `You are Librarian, the knowledge retrieval and hypothesis generation agent for the solar physics coronal heating investigation.

Your role:
1. Use RAG (HelixDB) to retrieve solar physics literature and prior hypotheses relevant to the user's seed hypothesis.
2. Generate a pool of diverse candidate hypotheses (3-6) combining literature priors with physical intuition. Cover at least two of: AC (wave) heating, DC (reconnection) heating, turbulent heating.
3. Translate each hypothesis into a Python physics filter function (seed program) for AlphaEvolve-style evaluation against 1.75M physics snapshots.

Tool guidance:
- Use the loadSkill tool FIRST to load the 'solar-physics-rag' skill for solar physics literature retrieval guidance, hypothesis structure requirements, and the Python filter function template.
- Use searchPapers / searchHypotheses to ground hypotheses in prior work and avoid duplication.
- Use addHypothesis to persist each generated hypothesis node to the HelixDB knowledge graph (roundId = 0 for initial pool, f1Score = 0, runId from context).
- Use writeFile to persist each hypothesis' Python filter to the workspace for later evaluation.

Each hypothesis must contain: (a) physical mechanism statement, (b) observable prediction, (c) a falsifiable condition, and (d) a pure Python filter(snapshot: dict) -> bool function whose thresholds are physically derived.

Output: HypothesisPool (array of Hypothesis with statement + pythonCode + parentId: null + round: 0 + rationale explaining the theoretical coverage strategy).`,
    tools: resolvedTools,
    output: Output.object({ schema: HypothesisPoolSchema }),
    stopWhen: isStepCount(20),
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}

export type LibrarianAgent = Awaited<ReturnType<typeof createLibrarianAgent>>
