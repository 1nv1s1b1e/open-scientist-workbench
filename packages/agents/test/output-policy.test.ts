import { describe, expect, it } from 'vite-plus/test'
import {
  createSubmitResultPrepareStep,
  withChineseOutputRequirement,
} from '../src/shared/output-policy.ts'

describe('agent output policy', () => {
  it('adds a final Chinese-language requirement to every specialist prompt', () => {
    const prompt = withChineseOutputRequirement('Research this hypothesis.')

    expect(prompt).toContain('Research this hypothesis.')
    expect(prompt).toContain('所有面向用户的过程说明和自然语言结果字段必须使用中文')
    expect(prompt).toContain('submit_result')
  })

  it('limits the final step to the structured submission tool without an incompatible forced choice', async () => {
    const prepareStep = createSubmitResultPrepareStep(12)

    const researchStep = await prepareStep({ stepNumber: 11 } as never)
    expect(researchStep).toBeUndefined()
    const forcedStep = await prepareStep({
      stepNumber: 12,
      instructions: '基础系统提示',
    } as never)

    expect(forcedStep).toMatchObject({
      activeTools: ['submit_result'],
      toolChoice: 'auto',
    })
    expect(forcedStep?.instructions).toContain('基础系统提示')
    expect(forcedStep?.instructions).toContain('不得继续调用 bash、检索、文件或其他工具')
    expect(forcedStep?.instructions).toContain('所有自然语言字段使用中文')

    const repeatedStep = await prepareStep({
      stepNumber: 13,
      instructions: forcedStep?.instructions,
    } as never)
    expect(typeof repeatedStep?.instructions).toBe('string')
    if (typeof repeatedStep?.instructions !== 'string') {
      throw new TypeError('submission instructions must be a string')
    }
    expect(repeatedStep.instructions.match(/【立即提交阶段】/g)).toHaveLength(1)
  })
})
