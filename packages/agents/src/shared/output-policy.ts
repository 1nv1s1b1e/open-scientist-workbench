import type { PrepareStepFunction, ToolSet } from 'ai'

const CHINESE_OUTPUT_REQUIREMENT = `【输出语言硬性要求】
所有面向用户的过程说明和自然语言结果字段必须使用中文。即使检索结果、skill 或工具说明是英文，也必须先理解再用中文表述。代码、工具名、JSON key、论文题名和不可翻译的标识符可以保留原文。调用 submit_result 时，其中的 statement、rationale、mechanism、predictions、falsificationConditions、critiqueText、mutationRationale、plan、logs、summary 等自然语言字段也必须使用中文。`

const SUBMISSION_PHASE_INSTRUCTIONS = `【立即提交阶段】
研究阶段已经结束。不得继续调用 bash、检索、文件或其他工具；当前唯一允许的动作是调用 submit_result。请根据已经取得的可核查资料填写工具 schema；未知内容使用 schema 允许的空值，不得编造来源、字段、数值或样本。所有自然语言字段使用中文。不要输出普通文本，立即调用 submit_result。`

export const AGENT_EXECUTION_BUDGETS = {
  librarian: { maxOutputTokens: 8192, submitAtStep: 8, maxSteps: 10 },
  looker: { maxOutputTokens: 3072, submitAtStep: 6, maxSteps: 8 },
  explore: { maxOutputTokens: 4096, submitAtStep: 10, maxSteps: 12 },
  oracle: { maxOutputTokens: 4096, submitAtStep: 8, maxSteps: 10 },
  prometheus: { maxOutputTokens: 3072, submitAtStep: 6, maxSteps: 8 },
} as const

/** Append one final, high-priority language instruction to a specialist prompt. */
export function withChineseOutputRequirement(prompt: string): string {
  if (prompt.includes(CHINESE_OUTPUT_REQUIREMENT)) return prompt
  return `${prompt.trim()}\n\n${CHINESE_OUTPUT_REQUIREMENT}`
}

/**
 * Force the agent to hand off a schema-valid result before it can exhaust its
 * research loop. Earlier steps keep the agent's normal tool policy.
 */
export function createSubmitResultPrepareStep(forceAtStep: number): PrepareStepFunction<ToolSet> {
  if (!Number.isInteger(forceAtStep) || forceAtStep < 1) {
    throw new RangeError('forceAtStep must be a positive integer')
  }

  return ({ stepNumber, instructions }) => {
    if (stepNumber < forceAtStep) return undefined
    const baseInstructions = typeof instructions === 'string' ? instructions.trim() : ''
    const submissionInstructions = baseInstructions.includes('【立即提交阶段】')
      ? baseInstructions
      : baseInstructions
        ? `${baseInstructions}\n\n${SUBMISSION_PHASE_INSTRUCTIONS}`
        : SUBMISSION_PHASE_INSTRUCTIONS
    return {
      activeTools: ['submit_result'],
      toolChoice: 'auto',
      instructions: submissionInstructions,
    }
  }
}
