import { WorkflowAgent } from '@ai-sdk/workflow'
import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { OracleOutputSchema } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import {
  addCritiqueTool,
  addMutationLinkTool,
  createBashToolForHypothesis,
  getCritiquesByHypothesisTool,
} from '@open-scientist/tools'
import { isStepCount, Output, type ToolSet } from 'ai'

export interface OracleAgentDeps {
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
}

/** Shared workspace subdir for Oracle (not per-hypothesis). */
const ORACLE_WORKSPACE_HYPO = '__oracle__'

/**
 * Assemble the default toolset for the Oracle agent.
 *
 * Tools:
 * - `addCritique` / `addMutationLink` / `getCritiquesByHypothesis` — HelixDB write/read
 *   for persisting critiques + mutation edges to the knowledge graph
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to a shared oracle workspace
 *   at `data/projects/<projectId>/workspace/__oracle__/` (project-scoped, not per-
 *   hypothesis; Oracle only runs lightweight test scripts to validate mutations)
 * - `loadSkill` — progressive disclosure (loads `critique-protocol` + `hypothesis-mutation` skills)
 *
 * NOTE: This function performs async I/O (skills fs scan + bash-tool sandbox init).
 * It must be called outside the workflow body OR inside a `'use step'` function if
 * called from within a workflow. The workflow below calls it before agent.stream().
 */
export async function getDefaultOracleTools(projectId: string): Promise<ToolSet> {
  const bashToolkit = await createBashToolForHypothesis(projectId, ORACLE_WORKSPACE_HYPO)
  const skills = await discoverSkills(createNodeSandbox(), [DEFAULT_SKILLS_DIR])
  const loadSkillTool = createLoadSkillTool(skills)

  return {
    addCritique: addCritiqueTool,
    addMutationLink: addMutationLinkTool,
    getCritiquesByHypothesis: getCritiquesByHypothesisTool,
    bash: bashToolkit.tools.bash,
    readFile: bashToolkit.tools.readFile,
    writeFile: bashToolkit.tools.writeFile,
    loadSkill: loadSkillTool,
  }
}

export async function createOracleAgent({ modelConfig, projectId, tools }: OracleAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const resolvedTools = tools ?? (await getDefaultOracleTools(projectId))

  return new WorkflowAgent({
    id: 'oracle',
    model,
    instructions: `You are Oracle, the Co-Scientist evaluator and tournament debater agent for the solar physics coronal heating investigation.

Your role:
1. Critique each evaluated hypothesis (Co-Scientist 5-dimension scoring: physical plausibility, observational consistency, falsifiability, theoretical completeness, novelty).
2. Mutate high-potential hypotheses (AlphaEvolve-style 4 operators: parameter / structural / crossover / counterexample-driven).
3. Eliminate low-score hypotheses (fill eliminatedIds with the ids of fatal / low-F1 hypotheses).
4. Optionally name a winner (winningHypoId) when the tournament has converged this round — otherwise null.
5. Debug counterexamples dialectically — cluster Explore's counterexamples by failure mode, decide fix vs. structural mutation vs. elimination.

Tool guidance:
- Load the 'critique-protocol' and 'hypothesis-mutation' skills FIRST for the 5-dimension scoring rubric, severity mapping (fatal/major/minor), mutation operator constraints, and the dialectical counterexample-debug flow.
- Use getCritiquesByHypothesis to read prior-round critiques on a hypothesis before re-critiquing (avoid repeating already-resolved points).
- Use addCritique to persist each critique you issue to HelixDB (createdAt = now ISO 8601).
- Use addMutationLink to record MUTATED_FROM edges between parent and child hypotheses (for evolution-chain tracking; use getEvolutionChain via HelixDB to detect cyclic mutations back to eliminated forms).
- Use bash / writeFile to write lightweight test scripts that verify a proposed mutation's filter behaves as intended on representative snapshot inputs before committing it. Working directory is project-scoped (\`__oracle__\` subdir), shared across all critiques in a round — keep it tidy.

Output contract (OracleOutputSchema):
- critiques[]: one Critique per evaluated hypothesis — { hypoId, critiqueText (specific, e.g. "fails in static strong-shear regions"), rationale (cite Explore counterexample or conservation law), severity (fatal/major/minor), round }.
- mutations[]: zero or more Mutations for high-potential parents — { parentHypoId, mutatedHypothesis (full HypothesisSchema with new id + parentId + round + status 'mutated' + fresh pythonCode consistent with statement), mutationRationale (operator type + what changed + why, citing counterexamples), round }.
- eliminatedIds[]: ids of hypotheses you eliminate this round (fatal critiques or low F1).
- winningHypoId: string | null — set only when convergence is reached this round; otherwise null.

Each major/fatal critique must pair with either a mutation or an elimination. Critique text must be physically specific (point to concrete parameters / bands / failure modes), never generic ("theory is flawed").

Tournament Evolution: act as a rigorous scientific reviewer. Use high thinking level for deep physical reasoning. Do NOT fabricate F1 numbers — Oracle only consumes Explore's EvalResults; it does not re-evaluate.`,
    tools: resolvedTools,
    output: Output.object({ schema: OracleOutputSchema }),
    stopWhen: isStepCount(25),
  })
}

export type OracleAgent = Awaited<ReturnType<typeof createOracleAgent>>
