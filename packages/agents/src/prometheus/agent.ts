import { WorkflowAgent } from '@ai-sdk/workflow'
import { PrometheusOutputSchema } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import { createBashToolForHypothesis, mhdConfigTool } from '@open-scientist/tools'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface PrometheusAgentDeps {
  model: LanguageModel
  /** Project name — drives shared prometheus workspace dir isolation. */
  projectId: string
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
}

/**
 * Shared workspace slot for the Prometheus agent. Not per-hypothesis — Prometheus
 * runs once per round and writes MHD cfg / observation proposals into a common dir.
 */
const PROMETHEUS_WORKSPACE = 'prometheus'

/**
 * Assemble the default toolset for the Prometheus agent.
 *
 * Tools:
 * - `mhdConfig` — mhdConfigTool (from @open-scientist/tools): writes the MHD .cfg
 *   file under `data/projects/<projectId>/mhd/<runId>.cfg` + returns MhdConfig
 *   (cfgPath / observationProposal / summary). Called only on the final round.
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to a SHARED prometheus
 *   workspace (`data/projects/<projectId>/workspace/prometheus/`). No sandbox —
 *   runs on host per AGENTS.md decision. Shared across rounds of one run.
 * - `loadSkill` — progressive disclosure (loads `mhd-config-gen` SKILL.md)
 *
 * NOTE: createBashTool is async (sandbox init) + discoverSkills does fs I/O, so this
 * whole factory is async. The workflow calls it before agent.stream() — outside any
 * 'use step' boundary is fine because workflow.ts is a 'use workflow' module and
 * can await. runtimeContext carries only serializable identifiers (projectId /
 * runId / round); no bash toolkit or HelixDB clients cross the workflow boundary.
 *
 * Tool-to-destination equivalence: createBashToolForHypothesis(projectId, 'prometheus')
 * calls createBashTool({ destination: getWorkspaceDir(projectId, 'prometheus') }) —
 * identical to the SPEC's literal form, but kept here via the tools package to avoid
 * a direct bash-tool dependency in the agents package.
 */
export async function getDefaultPrometheusTools(projectId: string): Promise<ToolSet> {
  const bashToolkit = await createBashToolForHypothesis(projectId, PROMETHEUS_WORKSPACE)
  const skills = await discoverSkills(createNodeSandbox(), [DEFAULT_SKILLS_DIR])
  const loadSkillTool = createLoadSkillTool(skills)

  return {
    mhdConfig: mhdConfigTool,
    bash: bashToolkit.tools.bash,
    readFile: bashToolkit.tools.readFile,
    writeFile: bashToolkit.tools.writeFile,
    loadSkill: loadSkillTool,
  }
}

export async function createPrometheusAgent({ model, projectId, tools }: PrometheusAgentDeps) {
  const resolvedTools = tools ?? (await getDefaultPrometheusTools(projectId))

  return new WorkflowAgent({
    id: 'prometheus',
    model,
    instructions: `You are Prometheus, the multi-round planning agent (Scaling Test-time Compute) for the solar physics coronal heating investigation.

Your role:
1. Based on current hypothesis score distribution and user (human-in-the-loop) physical intuition, dynamically adjust next round's mutation search physical parameter ranges.
2. Allocate compute budget (maxEvals, parallelWorkers).
3. On final round convergence: translate winning hypothesis to MHD simulation config (.cfg) + satellite observation proposal.

Use high thinking level for strategic planning.

Tool guidance:
- Load the 'mhd-config-gen' skill for MHD configuration generation guidance — do this FIRST on the final round (or when convergence is reached) before calling mhdConfig. The skill covers .cfg field layout, parameter derivation from the winning filter thresholds, the observation proposal format, and the recommended satellite/instrument table (SDO/AIA, SDO/HMI, Hinode/XRT, IRIS, Parker Solar Probe, Solar Orbiter).
- Use mhdConfig ONLY on the final round: pass runId, winningHypoId, hypothesisStatement, and a physically-derived physicalParams record. The tool writes the .cfg and returns the MhdConfig object — embed it verbatim in your output.
- Use bash / readFile / writeFile for any auxiliary computation (e.g. computing derived dimensionless numbers, sanity-checking parameter magnitudes against quiet-Sun ~300 W/m² heating).
- On non-final rounds: do NOT call mhdConfig. Output plan with adjusted searchParams + computeBudget, mhdConfig: null, shouldContinue: true.

Convergence rule (set shouldContinue):
- shouldContinue = false when currentBestF1 >= 0.9 OR round >= 10 OR isFinalRound flag is set.
- Otherwise shouldContinue = true.

Output: PrometheusOutput { plan: PlanSchema, mhdConfig: MhdConfigSchema | null, shouldContinue: boolean }. On non-final rounds mhdConfig MUST be null; on the final round mhdConfig MUST be non-null and produced via the mhdConfig tool.`,
    tools: resolvedTools,
    output: Output.object({ schema: PrometheusOutputSchema }),
    stopWhen: isStepCount(20),
  })
}

export type PrometheusAgent = Awaited<ReturnType<typeof createPrometheusAgent>>
