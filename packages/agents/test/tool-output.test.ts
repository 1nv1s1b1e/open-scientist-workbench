import { describe, expect, it } from 'vite-plus/test'
import { normalizeSubmitResultInput } from '../src/shared/tool-output.ts'

describe('normalizeSubmitResultInput', () => {
  it('unwraps a JSON value provided as a string parameter', () => {
    expect(normalizeSubmitResultInput({ values: '["a","b"]', rationale: '测试' })).toEqual({
      values: ['a', 'b'],
      rationale: '测试',
    })
  })

  it('unwraps Qwen-style parameter segments from the first string field', () => {
    expect(
      normalizeSubmitResultInput({
        hypotheses: '\n[{"id":"h1"}],\n<parameter=rationale>\n使用本地数据。',
      }),
    ).toEqual({ hypotheses: [{ id: 'h1' }], rationale: '使用本地数据。' })
  })

  it('unwraps Qwen-style JSON members packed into the first parameter', () => {
    expect(
      normalizeSubmitResultInput({
        hypotheses: '\n[{"id":"h1"}], "rationale": "???????"',
      }),
    ).toEqual({ hypotheses: [{ id: 'h1' }], rationale: '???????' })
  })

  it('unwraps Qwen-style packed members that already close the outer object', () => {
    expect(
      normalizeSubmitResultInput({
        hypotheses: '\n[{"id":"h1"}], "rationale": "基于已核验来源"}\n',
      }),
    ).toEqual({ hypotheses: [{ id: 'h1' }], rationale: '基于已核验来源' })
  })
})
