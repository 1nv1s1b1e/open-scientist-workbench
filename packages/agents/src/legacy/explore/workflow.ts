import { type AgentRuntimeConfig, getDatasetDir, type ModelArg } from '@open-scientist/config'
import type { EvalResult } from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import { type EmitChunk } from '../../shared/stream.ts'
import { resolveAgentConfigArgs, runAgentWorkflow } from '../../shared/run-workflow.ts'
import { createExploreAgent } from './agent.ts'
import { evaluatePythonFilter } from './evaluate.ts'

export interface ExploreWorkflowInput {
  hypoId: string
  projectId: string
  runId: string
  round: number
  hypothesis: { statement: string; pythonCode: string }
  modelConfig: ModelArg
  agentConfig?: AgentRuntimeConfig
  emitChunk?: EmitChunk
  abortSignal?: AbortSignal
}

/** Run Explore, then recompute its metrics from the configured dataset. */
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

  const prompt = `请在已配置的数据集上评估以下假设。
首先读取 ${datasetDir}/dataset_manifest.json。filter() 只能使用其中列出的特征列，严禁读取 targets.jsonl 或使用任何真实标签列。

假设 id：${input.hypoId}
运行 id：${input.runId}
轮次：${input.round}
数据集目录：${datasetDir}

假设：
${input.hypothesis.statement}

Python 过滤代码：
${input.hypothesis.pythonCode}

步骤：
1. 加载 fits-snapshot-search skill 并读取 manifest。
2. 在工作区写入 filter.py，然后运行：python ${datasetDir}/eval.py filter.py
3. 检查 JSON 输出和反例；不得编造或修改任何指标。
4. 如果评估器返回 candidateSnapshots，必须原样传递；它们是后续 FITS/视频对齐唯一允许使用的输入。
5. 调用 submit_result。服务端会独立重跑假设代码，并以确定性结果为准。
`

  if (input.emitChunk) {
    input.emitChunk({
      type: 'custom',
      kind: 'tournament.phase-start',
      role: 'explore',
      round: input.round,
      hypoId: input.hypoId,
    } as unknown as UIMessageChunk)
  }

  const modelResult = await runAgentWorkflow<EvalResult>({
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
      candidateSnapshots: [],
      logs: 'Explore 未在步数上限前调用 submit_result。',
      executionMs: 0,
    },
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
  })

  const deterministicResult = await evaluatePythonFilter({
    datasetDir,
    filterCode: input.hypothesis.pythonCode,
    hypoId: input.hypoId,
  })

  return {
    ...deterministicResult,
    logs: `${modelResult.logs}\n${deterministicResult.logs}`,
  }
}
