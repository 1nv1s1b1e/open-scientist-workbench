import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { getMcpTools } from '@open-scientist/mcp'
import { type McpServerConfig, TournamentResultSchema } from '@open-scientist/schema'
import { isStepCount, Output, ToolLoopAgent, type ToolSet, tool } from 'ai'
import { z } from 'zod'

export interface SisyphusAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Kept for uniformity with the
   * other 5 agents even though `tournamentWorkflow` currently drives the
   * tournament via deterministic control flow rather than Sisyphus' own LLM
   * loop. Never pass a `LanguageModel` instance across call boundaries (keep
   * it as plain data).
   */
  modelConfig: ModelArg
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
  /**
   * Optional system prompt override. When omitted, the hardcoded default
   * (Sisyphus orchestrator role description) is used.
   */
  instructions?: string
  /**
   * Optional MCP server list. Tools from each server are fetched via
   * `getMcpTools` and merged into the default toolset. Only consulted when
   * `tools` is not provided (caller-provided toolsets take full precedence).
   */
  mcpServers?: McpServerConfig[]
  /**
   * Optional runtime context passed to the ToolLoopAgent constructor. Carries
   * serializable identifiers (projectId / runId) for telemetry and lineage.
   * Must be plain data (no functions / class instances).
   */
  runtimeContext?: Record<string, unknown>
}

/**
 * Sisyphus-specific human-in-the-loop tool. Pauses the tournament at the end of
 * a round so a physicist can review the leading hypothesis and either approve
 * (continue), reject (force another round), or inject steering feedback.
 *
 * Approval is wired via `toolApproval` on the ToolLoopAgent constructor (see
 * `createSisyphusAgent` below), NOT via the deprecated tool-level
 * `needsApproval`. When `toolApproval.review_leading_hypothesis` returns
 * `'user-approval'`, the stream suspends and emits a `tool-approval-request`
 * chunk. The Phase 4 API layer captures that chunk, surfaces it to the user
 * via SSE, and injects the user's response back into the agent stream to
 * resume execution.
 *
 * The execute body below is the fallback that runs after the user approves
 * (or when the tool is invoked outside an approval-bearing call context).
 * When the user denies, the tool is not executed and the agent receives a
 * denial result that it can react to in its next step.
 *
 * Sisyphus does NOT drive its own agent.stream() loop in the current
 * tournament implementation — `tournamentWorkflow` is deterministic control
 * flow that direct-awaits the 5 sub-agent runs. This tool is wired here for
 * the Phase 4 API layer to invoke when it spins up a Sisyphus agent.stream()
 * for free-form steering or the review node. See `tournamentWorkflow` for the
 * `onReviewLeadingHypothesis` callback hook that lets the deterministic
 * tournament pause for human review without an LLM loop.
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
  execute: async () => {
    // Default fallback when invoked outside an approval-bearing call context.
    // When `toolApproval` returns `'user-approval'`, the stream suspends
    // before reaching execute; on resume the user's decision is injected and
    // execute runs with the approved input (or the tool is skipped on deny).
    return { approved: true, feedback: null }
  },
})

/**
 * Assemble the default toolset for the Sisyphus orchestrator agent.
 *
 * Tools:
 * - `review_leading_hypothesis` — the Sisyphus-exclusive human-in-the-loop
 *   approval tool. Approval is configured via `toolApproval` on the
 *   ToolLoopAgent constructor (not the deprecated tool-level
 *   `needsApproval`). Used at the end of high-stakes rounds to let a
 *   physicist review the leader before Prometheus commits to the next
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
export async function getDefaultSisyphusTools(mcpServers?: McpServerConfig[]): Promise<ToolSet> {
  const baseTools: ToolSet = {
    review_leading_hypothesis: reviewLeadingHypothesisTool,
  }
  if (mcpServers && mcpServers.length > 0) {
    for (const server of mcpServers) {
      const mcpTools = await getMcpTools(server)
      Object.assign(baseTools, mcpTools)
    }
  }
  return baseTools
}

/**
 * Create the Sisyphus orchestrator agent.
 *
 * Sisyphus is the Tournament Evolution conductor. In the current Phase 4
 * implementation, `tournamentWorkflow` (workflow.ts) drives the tournament via
 * deterministic control flow — it direct-awaits the 5 sub-agent runs
 * (librarian → looker → explore ×N parallel → oracle → prometheus) and does
 * NOT spin up a Sisyphus LLM loop itself. The agent is still constructed and
 * exported so the Phase 4 API layer can use it for:
 *   - interpreting free-form user steering messages mid-tournament,
 *   - driving the `review_leading_hypothesis` approval tool when the
 *     human-in-the-loop node is wired in via `toolApproval`.
 *
 * The `toolApproval` setting on the ToolLoopAgent constructor configures the
 * `review_leading_hypothesis` tool to require user approval: when the agent
 * calls that tool, the stream suspends and emits a `tool-approval-request`
 * chunk. The Phase 4 API layer surfaces that to the frontend via SSE and
 * injects the user's response to resume. This replaces the deprecated
 * tool-level `needsApproval` mechanism.
 *
 * Output schema (TournamentResult) + stopWhen (isStepCount(50)) are fixed by
 * the SPEC — do not change them.
 */
export async function createSisyphusAgent({
  modelConfig,
  tools,
  instructions,
  mcpServers,
  runtimeContext,
}: SisyphusAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const resolvedTools = tools ?? (await getDefaultSisyphusTools(mcpServers))

  return new ToolLoopAgent({
    id: 'sisyphus',
    model,
    instructions:
      instructions ??
      `You are Sisyphus, the orchestrator agent of a solar physics multi-agent system investigating the coronal heating mystery.

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
    // Configure the review_leading_hypothesis tool to require user approval.
    // When the agent calls this tool, the stream suspends and emits a
    // `tool-approval-request` chunk. The Phase 4 API layer surfaces that to
    // the frontend via SSE and injects the user's response to resume.
    // This replaces the deprecated tool-level `needsApproval` mechanism.
    toolApproval: {
      review_leading_hypothesis: 'user-approval',
    },
    ...(runtimeContext !== undefined ? { runtimeContext } : {}),
  })
}

export type SisyphusAgent = Awaited<ReturnType<typeof createSisyphusAgent>>
