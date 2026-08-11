import {
  createModelFromConfig,
  thinkingLevelToProviderOptions,
  type ModelArg,
} from '@open-scientist/config'
import { hasToolCall, isStepCount, ToolLoopAgent, type ToolSet } from 'ai'
import type { ZodType } from 'zod'
import { runAgentWorkflow } from '../shared/run-workflow.ts'
import type { EmitChunk } from '../shared/stream.ts'
import { makeSubmitResultTool } from '../shared/tool-output.ts'

export interface ScientificModelTaskInput<TOutput> {
  projectId: string
  runId: string
  agentId: string
  role: string
  modelConfig: ModelArg
  schema: ZodType<TOutput>
  prompt: string
  emitChunk?: EmitChunk
  abortSignal?: AbortSignal
  maxOutputTokens?: number
  round?: number
}

/**
 * Run one bounded, schema-first scientific model task.
 *
 * The model has exactly one public action: submit a validated result. This
 * avoids shell/file chatter, prevents open-ended tool loops, and keeps the
 * user-facing summary synchronized with the object that enters LangGraph.
 */
export async function runScientificModelTask<TOutput>(
  input: ScientificModelTaskInput<TOutput>,
): Promise<TOutput> {
  const tools: ToolSet = {
    submit_result: makeSubmitResultTool(input.schema),
  }
  const stage = input.role === 'sisyphus' ? 'C' : input.role === 'prometheus' ? 'D' : 'B'
  const instructions = `你是太阳物理科研工作流中的 ${input.agentId}。
只使用用户消息中明确提供的现象、文献条目、数据处理指标、来源 ID 和状态记录。不得补写不存在的观测、数值、论文或因果关系。
你的输出会直接进入可审计的 LangGraph State。summary/reasoningSummary 是面向用户的公开工作摘要，应说明使用了哪些事实、得出了什么有限判断、仍有哪些边界；不要声称它是内部隐藏思维链。
所有自然语言字段必须使用中文。必须立即调用 submit_result，且不得输出普通文本。`

  const execute = (prompt: string, maxOutputTokens: number) => {
    const agent = new ToolLoopAgent({
      id: input.agentId,
      model: createModelFromConfig(input.modelConfig),
      providerOptions: thinkingLevelToProviderOptions(
        input.modelConfig.provider,
        input.modelConfig.thinkingLevel,
      ),
      tools,
      maxOutputTokens,
      toolChoice: 'auto',
      stopWhen: [hasToolCall('submit_result'), isStepCount(2)],
      instructions,
    })

    return runAgentWorkflow<TOutput>({
      agent,
      projectId: input.projectId,
      runId: input.runId,
      role: input.role,
      stage,
      agentId: input.agentId,
      modelConfig: input.modelConfig,
      prompt,
      emitChunk: input.emitChunk,
      abortSignal: input.abortSignal,
    })
  }

  const initialBudget = input.maxOutputTokens ?? 2400
  try {
    return await execute(input.prompt, initialBudget)
  } catch (error) {
    if (input.abortSignal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (!/submit_result|step limit|tool|schema|json/i.test(message)) throw error
    const round = input.round ?? 1
    input.emitChunk?.({
      type: 'custom',
      kind: 'scientific.self-correction',
      correction: {
        correctionId: `model-retry-${input.agentId}-${round}-${Date.now()}`,
        stage,
        kind: 'execution',
        severity: 'warning',
        message: `${input.agentId} 的首次结构化提交不完整，已触发一次受限重试。`,
        action: '压缩公开摘要并提高结构化答案预算；首次未完成内容不进入 State。',
        affectedIds: [input.agentId],
        triggeredBy: [input.agentId],
        round,
        agentId: input.agentId,
      },
    } as never)
    return execute(
      `${input.prompt}\n\n上一次 submit_result 因结构化参数不完整而被拒绝。请显著压缩文字，只保留每个字段必需的事实与边界，并一次性提交完整 JSON；不要重复背景。`,
      Math.max(initialBudget + 2000, 5200),
    )
  }
}
