/**
 * Shared workflow tail for the 5 specialist agent workflows.
 *
 * Every specialist workflow (librarian / looker / explore / oracle / prometheus)
 * ends with the same 4-step sequence after constructing its agent:
 *
 *   1. `agent.stream({ messages, abortSignal })`
 *   2. `streamAgentOutput(result.fullStream, agent.tools, emitChunk)` — drain
 *      the stream into the optional SSE chunk sink (must happen even when
 *      `emitChunk` is undefined, else `result.staticToolCalls` hangs).
 *   3. `persistAgentRun(projectId, runId, role, prompt, result)` — best-effort
 *      conversation persistence to the project SQLite `messages` table.
 *   4. `extractSubmitResult(staticToolCalls, 'submit_result', fallback)` —
 *      pull the submitted result from `result.staticToolCalls`, falling back
 *      to a zero-valued `fallback` when the agent hit its step limit without
 *      calling `submit_result`.
 *
 * The `agentConfig` override spread (`modelConfig ?? ` +
 * instructions/skillDirectories/mcpServers conditional spreads) is also
 * identical across the 5 workflows. `resolveAgentConfigArgs` concentrates
 * that idiom so a change to the spread contract lands in one place.
 *
 * Sisyphus is excluded — `tournamentWorkflow` is deterministic control flow
 * that direct-awaits the 4 sub-workflows; it does not call this helper.
 */
import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { ModelMessage, TextStreamPart, ToolSet } from 'ai'
import { persistAgentRun } from './persist.ts'
import { type EmitChunk, streamAgentOutput } from './stream.ts'
import { extractSubmitResult } from './tool-output.ts'

/**
 * The agent-factory invocation args that every specialist workflow builds
 * from its `agentConfig` override. Extracted here so each workflow can pass
 * them to its `createAgent` without re-deriving the spread idiom.
 *
 * `modelConfig` is always present (resolved from `agentConfig?.modelConfig ??
 * input.modelConfig`). `instructions` / `skillDirectories` / `mcpServers`
 * are present only when `agentConfig` overrides them.
 *
 * Workflows merge this with their agent-specific fields (projectId, runId,
 * hypoId) before passing to the factory:
 * ```ts
 * const agent = await createLibrarianAgent({
 *   ...resolveAgentConfigArgs(input.modelConfig, input.agentConfig),
 *   projectId: input.projectId,
 *   runId: input.runId,
 *   runtimeContext: { projectId: input.projectId, runId: input.runId },
 * })
 * ```
 */
export type AgentConfigOverrideArgs = {
  modelConfig: ModelArg
} & Partial<{
  instructions: string
  skillDirectories: string[]
  mcpServers: AgentRuntimeConfig['mcpServers']
}>

/**
 * Build the agent-factory config-override args from a workflow input's
 * `agentConfig` override + fallback `modelConfig`.
 *
 * This replaces the 6× duplicated spread idiom:
 * ```ts
 * modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
 * ...(input.agentConfig?.instructions !== undefined
 *   ? { instructions: input.agentConfig.instructions }
 *   : {}),
 * // … repeat for skillDirectories, mcpServers
 * ```
 *
 * The caller merges the result with its agent-specific fields (projectId,
 * runId, hypoId) and `runtimeContext` before passing to the factory.
 */
export function resolveAgentConfigArgs(
  modelConfig: ModelArg,
  agentConfig: AgentRuntimeConfig | undefined,
): AgentConfigOverrideArgs {
  return {
    modelConfig: agentConfig?.modelConfig ?? modelConfig,
    ...(agentConfig?.instructions !== undefined ? { instructions: agentConfig.instructions } : {}),
    ...(agentConfig?.skillDirectories !== undefined
      ? { skillDirectories: agentConfig.skillDirectories }
      : {}),
    ...(agentConfig?.mcpServers !== undefined ? { mcpServers: agentConfig.mcpServers } : {}),
  }
}

/**
 * Minimal structural type for a constructed agent — just the fields the
 * workflow tail consumes.
 */
interface AgentForWorkflow {
  tools: ToolSet
  stream: (opts: { messages: ModelMessage[]; abortSignal?: AbortSignal }) => Promise<{
    fullStream: ReadableStream<TextStreamPart<ToolSet>>
    staticToolCalls: PromiseLike<Parameters<typeof extractSubmitResult>[0]>
    responseMessages: PromiseLike<Array<{ role: string; content: unknown }>>
    steps: PromiseLike<Array<unknown>>
    usage: PromiseLike<unknown>
    finishReason: PromiseLike<unknown>
  }>
}

export interface RunAgentWorkflowOptions<TOutput> {
  /** The constructed agent (from `createXxxAgent`). */
  agent: AgentForWorkflow
  /** Project id — for workspace isolation + persistence. */
  projectId: string
  /** Run id — for persistence + lineage. */
  runId: string
  /** Agent role name (e.g. `'librarian'`) — used as the persistence key. */
  role: string
  /** The user prompt sent to the agent. */
  prompt: string
  /**
   * Zero-valued result returned when the agent hits its step limit without
   * calling `submit_result`. Keeps the tournament resilient.
   */
  fallback: TOutput
  /** Optional SSE chunk sink. */
  emitChunk?: EmitChunk
  /** Optional abort signal threaded into `agent.stream({abortSignal})`. */
  abortSignal?: AbortSignal
}

/**
 * Run the workflow tail for a specialist agent: stream its output, persist
 * the conversation, and extract the submitted result (or `fallback`).
 *
 * The caller constructs the agent (using `resolveAgentConfigArgs` for the
 * config spread) and passes it here. This concentrates the
 * stream→persist→extract contract so a change to it lands in one place.
 *
 * Returns the agent's submitted result (type `TOutput`).
 */
export async function runAgentWorkflow<TOutput>({
  agent,
  projectId,
  runId,
  role,
  prompt,
  fallback,
  emitChunk,
  abortSignal,
}: RunAgentWorkflowOptions<TOutput>): Promise<TOutput> {
  const result = await agent.stream({
    messages: [{ role: 'user', content: prompt }],
    ...(abortSignal ? { abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, emitChunk)
  await persistAgentRun(projectId, runId, role, prompt, result)
  const staticToolCalls = await result.staticToolCalls
  return extractSubmitResult(staticToolCalls, 'submit_result', fallback)
}
