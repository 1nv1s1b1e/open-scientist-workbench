import { createLogger } from '@open-scientist/logger'
import { appendMessage } from '@open-scientist/storage'

const logger = createLogger('agents')

export interface AgentRunTelemetry {
  steps: number
  usage: unknown
  finishReason: unknown
  submittedAt: string
}

/**
 * Persist an agent run's conversation history to the project SQLite `messages`
 * table. Called from each sub-workflow after `agent.stream()` completes.
 *
 * Stores:
 * - 1 `user` message (the prompt sent to the agent)
 * - N `assistant` + `tool` messages (from `result.responseMessages`)
 * - 1 `system` summary (agent name, step count, usage, finish reason, submitted at)
 *
 * Failures are logged but do not throw — persistence is best-effort and must
 * not break the tournament flow.
 *
 * @param projectId  Project name (used to locate the project DB).
 * @param runId      Tournament run identifier.
 * @param agentName  Agent role name (e.g. "librarian", "explore").
 * @param prompt     The user message content sent to the agent.
 * @param result     The `StreamTextResult` from `agent.stream()`.
 */
export async function persistAgentRun(
  projectId: string,
  runId: string,
  agentName: string,
  prompt: string,
  result: {
    responseMessages: PromiseLike<Array<{ role: string; content: unknown }>>
    steps: PromiseLike<Array<unknown>>
    usage: PromiseLike<unknown>
    finishReason: PromiseLike<unknown>
  },
): Promise<AgentRunTelemetry | null> {
  try {
    const [responseMessages, steps, usage, finishReason] = await Promise.all([
      result.responseMessages,
      result.steps,
      result.usage,
      result.finishReason,
    ])

    // Store the user prompt
    await appendMessage(projectId, runId, 'user', [
      { agent: agentName, type: 'text', text: prompt },
    ])

    // Store each response message (assistant + tool turns)
    for (const msg of responseMessages) {
      await appendMessage(projectId, runId, msg.role as 'assistant' | 'tool', [
        msg.content as Parameters<typeof appendMessage>[3][number],
      ])
    }

    // Store a summary record
    const telemetry: AgentRunTelemetry = {
      steps: (steps as Array<unknown>).length,
      usage,
      finishReason,
      submittedAt: new Date().toISOString(),
    }
    await appendMessage(projectId, runId, 'system', [{ agent: agentName, ...telemetry }])

    logger.debug(
      { projectId, runId, agentName, messageCount: responseMessages.length + 2 },
      'persistAgentRun: persisted agent conversation',
    )
    return telemetry
  } catch (err) {
    logger.error(
      { projectId, runId, agentName, error: (err as Error).message },
      'persistAgentRun: failed to persist (non-fatal)',
    )
    return null
  }
}
