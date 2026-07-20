import { WorkflowAgent } from '@ai-sdk/workflow'
import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { getMcpTools } from '@open-scientist/mcp'
import { EvalResultSchema, type McpServerConfig } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import { createBashToolForHypothesis } from '@open-scientist/tools'
import { isStepCount, Output, type ToolSet } from 'ai'

export interface ExploreAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name — drives workspace dir isolation. */
  project: string
  /** Hypothesis id — each hypothesis gets its own isolated bash workspace. */
  hypoId: string
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
}

/**
 * Assemble the default toolset for the Explore agent, bound to a per-hypothesis workspace.
 *
 * Tools:
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to
 *   `data/projects/<project>/workspace/<hypoId>/` (project + hypothesis isolation,
 *   no sandbox — runs Python directly on host per AGENTS.md decision)
 * - `loadSkill` — progressive disclosure (loads `fits-snapshot-search` SKILL.md)
 *
 * NOTE: createBashTool is async (sandbox init), so this whole factory is async. The
 * workflow calls it before agent.stream() — outside any 'use step' boundary is fine
 * because workflow.ts itself is a 'use workflow' module and can await.
 *
 * Each hypothesis evaluation gets a FRESH agent instance + FRESH bash workspace, so
 * parallel evaluations (Sisyphus spawns N explore workflows) don't share working dirs.
 */
export async function getDefaultExploreTools(
  project: string,
  hypoId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  const dirs = skillDirectories ?? [DEFAULT_SKILLS_DIR]
  const bashToolkit = await createBashToolForHypothesis(project, hypoId)
  const skills = await discoverSkills(createNodeSandbox(), dirs)
  const loadSkillTool = createLoadSkillTool(skills)

  const baseTools: ToolSet = {
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

export async function createExploreAgent({
  modelConfig,
  project,
  hypoId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
}: ExploreAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const resolvedTools =
    tools ?? (await getDefaultExploreTools(project, hypoId, skillDirectories, mcpServers))

  return new WorkflowAgent({
    id: 'explore',
    model,
    instructions:
      instructions ??
      `You are Explore, the AlphaEvolve-style deterministic evaluator agent for the solar physics coronal heating investigation.

Your role:
1. Take a candidate hypothesis Python filter function (def filter(snapshot: dict) -> bool).
2. Execute it in the working directory via bash-tool (write run.py, python3 run.py, read stdout, debug, re-run).
3. Search across 1.75M physics snapshots, compute F1 score (precision/recall against ground-truth heating-event labels).
4. Iterate: read stdout, debug counterexamples (FP/FN), modify code, re-run — until convergence or step limit.
5. Output EvalResult (F1, true/false positives, false negatives, counterexamples[], logs, executionMs).

Tool guidance:
- Use the loadSkill tool FIRST to load the 'fits-snapshot-search' skill for snapshot dataset structure, F1 computation contract, Python environment setup (uv pip install astropy sunpy scipy numpy), and the debug loop pattern.
- Working directory is project + hypothesis isolated. No sandbox restrictions — run Python directly on host. First run may need to install deps: \`python3 -m venv .venv && source .venv/bin/activate && uv pip install astropy sunpy scipy numpy\`.
- Counterexample logs must be physically specific (e.g. "strong shear but low temperature, filter didn't constrain temperature floor") — not just "prediction wrong". These feed Oracle's next-round mutation.
- F1 = 2·P·R / (P + R); when P+R=0, F1=0. TP/FP/FN counts MUST be filled in EvalResult.

Output: EvalResult (hypoId, f1, truePositives, falsePositives, falseNegatives, counterexamples[], logs, executionMs).`,
    tools: resolvedTools,
    output: Output.object({ schema: EvalResultSchema }),
    stopWhen: isStepCount(30),
  })
}

export type ExploreAgent = Awaited<ReturnType<typeof createExploreAgent>>
