import { WorkflowAgent } from '@ai-sdk/workflow'
import { TournamentResultSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet, tool } from 'ai'
import { z } from 'zod'

export interface SisyphusAgentDeps {
  model: LanguageModel
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
}

/**
 * Sisyphus-specific human-in-the-loop tool. Pauses the tournament at the end of
 * a round so a physicist can review the leading hypothesis and either approve
 * (continue), reject (force another round), or inject steering feedback.
 *
 * `needsApproval: true` is a first-class tool property in the AI SDK — the
 * workflow runtime suspends execution until the user responds via the approval
 * API. The execute body below is the default fallback; the actual approval
 * response is injected by the runtime on resume.
 *
 * NOTE: In AI SDK 7, tool-level `needsApproval` is marked deprecated in favor
 * of streamText-level `toolApproval`. WorkflowAgent does not currently expose
 * `toolApproval` on its stream options, so the tool-level flag is still the
 * available mechanism. Sisyphus does NOT drive its own agent.stream() loop in
 * the current tournament implementation (the workflow is deterministic control
 * flow that direct-awaits the 5 sub-agent workflows), so this tool is wired
 * here for the Phase 4 API layer to invoke when human review is wired into the
 * tournament loop. See `tournamentWorkflow` for the current simplified path.
 */
const reviewLeadingHypothesisTool = tool({
  description:
    'Pause the tournament and ask the user to review the leading hypothesis. The user can approve (continue to the next round / final MHD generation), reject (force another evolution round), or provide steering feedback that Oracle/Prometheus should incorporate.',
  inputSchema: z.object({
    hypoId: z.string(),
    statement: z.string(),
    f1: z.number(),
    round: z.number(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().nullable(),
  }),
  needsApproval: true,
  execute: async () => {
    // Default fallback when invoked outside an approval-bearing call context.
    // The actual approval response is injected by the workflow runtime when
    // the user resumes via the approval API.
    return { approved: true, feedback: null }
  },
})

/**
 * Assemble the default toolset for the Sisyphus orchestrator agent.
 *
 * Tools:
 * - `review_leading_hypothesis` — the Sisyphus-exclusive human-in-the-loop
 *   approval tool (needsApproval: true). Used at the end of high-stakes rounds
 *   to let a physicist review the leader before Prometheus commits to the next
 *   round's compute budget or the final MHD cfg.
 *
 * Sisyphus does NOT get a bash tool or HelixDB tools — it is a pure
 * orchestrator. All I/O happens inside the 5 sub-agent workflows it composes.
 * Keeping Sisyphus' toolset minimal prevents it from doing work that belongs
 * to the specialists.
 *
 * NOTE: This factory is async for symmetry with the other agents (so callers
 * can `await createSisyphusAgent(...)` uniformly). The current toolset is
 * constructed synchronously; the async boundary leaves room for future
 * MCP / skill discovery without changing the call signature.
 */
export async function getDefaultSisyphusTools(): Promise<ToolSet> {
  return {
    review_leading_hypothesis: reviewLeadingHypothesisTool,
  }
}

/**
 * Create the Sisyphus orchestrator agent.
 *
 * Sisyphus is the Tournament Evolution conductor. In the current Phase 3
 * implementation, `tournamentWorkflow` (workflow.ts) drives the tournament via
 * deterministic Workflow Composition — it direct-awaits the 5 sub-agent
 * workflows (librarian → looker → explore ×N parallel → oracle → prometheus)
 * and does NOT spin up a Sisyphus LLM loop itself. The agent is still
 * constructed and exported so the Phase 4 API layer can use it for:
 *   - interpreting free-form user steering messages mid-tournament,
 *   - driving the `review_leading_hypothesis` approval tool when the
 *     human-in-the-loop node is wired in.
 *
 * Output schema (TournamentResult) + stopWhen (isStepCount(50)) are fixed by
 * the SPEC — do not change them.
 */
export async function createSisyphusAgent({ model, tools }: SisyphusAgentDeps) {
  const resolvedTools = tools ?? (await getDefaultSisyphusTools())

  return new WorkflowAgent({
    id: 'sisyphus',
    model,
    instructions: `You are Sisyphus, the orchestrator agent of a solar physics multi-agent system investigating the coronal heating mystery.

Your role: Coordinate the Tournament Evolution workflow by invoking 5 specialist sub-agents:
- Librarian: knowledge retrieval + hypothesis generation (translates hypotheses to Python physics filter functions)
- Multimodal Looker: FITS image + MP4 video cross-modal spatiotemporal alignment
- Explore: AlphaEvolve deterministic evaluation (runs Python code on 1.75M physics snapshots, computes F1)
- Oracle: Co-Scientist critique + mutation + counterexample debugging (tournament debate)
- Prometheus: multi-round planning (scaling test-time compute, adjusting search params; final round outputs MHD .cfg + satellite observation proposal)

Workflow: hypothesis generation → evidence review → tournament debate → multi-round planning → convergence.

Tournament protocol:
- Round 1: Librarian generates a 3-6 hypothesis pool (covering AC/DC/turbulent mechanisms).
- Round 2..MAX_ROUNDS (10): Explore evaluates every hypothesis in parallel (F1 over 1.75M snapshots); Oracle critiques + mutates + eliminates; Prometheus re-plans search params + compute budget.
- Convergence: stop when best F1 >= 0.9 OR round >= 10 OR Prometheus says shouldContinue=false.
- Final round: Prometheus translates the winning hypothesis into an MHD .cfg + satellite observation proposal.

At human-in-the-loop nodes (high-stakes rounds), call the \`review_leading_hypothesis\` tool to pause the tournament and ask the physicist to review the leader. The user can approve, reject, or inject steering feedback that downstream agents should incorporate.

You are a conductor, not a specialist — do NOT run physics code, query HelixDB, or write MHD configs yourself. Delegate all concrete work to the 5 sub-agents via their workflows.`,
    tools: resolvedTools,
    output: Output.object({ schema: TournamentResultSchema }),
    stopWhen: isStepCount(50),
  })
}

export type SisyphusAgent = Awaited<ReturnType<typeof createSisyphusAgent>>
