import { type AgentRuntimeConfig, getDatasetDir, type ModelArg } from '@open-scientist/config'
import type { EvalResult } from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import { type EmitChunk } from '../shared/stream.ts'
import { resolveAgentConfigArgs, runAgentWorkflow } from '../shared/run-workflow.ts'
import { createExploreAgent } from './agent.ts'

export interface ExploreWorkflowInput {
  /** Hypothesis id — drives per-hypothesis workspace isolation. */
  hypoId: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Tournament round (1-based). Round 1 = initial Librarian pool evaluation. */
  round: number
  /** The hypothesis to evaluate. */
  hypothesis: {
    statement: string
    pythonCode: string
  }
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createExploreAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour.
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback. The orchestrator
   * uses it to buffer chunks for SSE replay / reconnect.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Explore workflow: AlphaEvolve deterministic evaluation of one hypothesis.
 *
 * Spawns a fresh ExploreAgent bound to a per-hypothesis bash workspace, runs
 * the hypothesis' Python filter against the 21,578-snapshot dataset, and
 * returns the EvalResult (F1 + counterexamples). The orchestrator
 * parallelizes this across the hypothesis pool via `Promise.all`.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it (after conversion via `toUIMessageStream`).
 */
export async function exploreWorkflow(input: ExploreWorkflowInput): Promise<EvalResult> {
  const datasetDir = getDatasetDir()
  const agent = await createExploreAgent({
    ...resolveAgentConfigArgs(input.modelConfig, input.agentConfig),
    projectId: input.projectId,
    runId: input.runId,
    hypoId: input.hypoId,
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
      hypoId: input.hypoId,
    },
  })

  const prompt = `在真实 SDO/HMI SHARP 磁场数据集（21,578 条快照）上评估此假设。

假设 id：${input.hypoId}
运行 id：${input.runId}
轮次：${input.round}
数据集目录：${datasetDir}

假设陈述：
${input.hypothesis.statement}

Python filter 代码：
\`\`\`python
${input.hypothesis.pythonCode}
\`\`\`

步骤：
1. 先加载 'fits-snapshot-search' skill 获取数据集结构 + 评估契约。
2. 将 filter 写入工作目录的 filter.py。
3. 运行：source ${datasetDir}/.venv/bin/activate && python3 ${datasetDir}/eval.py filter.py
4. 读取 JSON 输出（F1、TP/FP/FN、反例）。如果 F1 低，调试反例，修改 filter.py，重新运行。
5. 共享 venv（含 numpy/scipy）在 ${datasetDir}/.venv。如需额外包：uv pip install --python ${datasetDir}/.venv/bin/python <package>
6. 返回 EvalResult，含 hypoId=${input.hypoId}、f1、truePositives、falsePositives、falseNegatives、counterexamples[]（物理具体）、logs（命令 + 关键 stdout）、executionMs。`

  // Emit phase-start right before streaming begins (not in the .map() caller)
  // so each hypothesis's phase-start fires when that workflow is actually ready,
  // not all at once before any Explore agent starts.
  if (input.emitChunk) {
    input.emitChunk({
      type: 'custom',
      kind: 'tournament.phase-start',
      role: 'explore',
      round: input.round,
      hypoId: input.hypoId,
    } as unknown as UIMessageChunk)
  }

  return runAgentWorkflow<EvalResult>({
    agent,
    projectId: input.projectId,
    runId: input.runId,
    role: 'explore',
    prompt,
    fallback: {
      hypoId: input.hypoId,
      f1: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      counterexamples: [],
      logs: 'Explore agent reached step limit without calling submit_result',
      executionMs: 0,
    },
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
  })
}
