import { describe, expect, it } from 'vite-plus/test'
import {
  describeTerminationReason,
  formatCorrectionMessage,
} from '../src/lib/workbench/workbench-copy.ts'

describe('workbench-facing copy', () => {
  it('turns infrastructure failures into an honest scientific-data boundary', () => {
    expect(
      formatCorrectionMessage(
        'error communicating with server: fetch failed. Cannot reach Helix at http://localhost:6969/v1/query',
      ),
    ).toBe('资料检索暂时不可用，相关结论保留为未知；服务恢复后需要重新核验。')
  })

  it('does not expose internal termination codes as the main user-facing label', () => {
    expect(describeTerminationReason('max_rounds_reached')).toBe('已达到设置的最大轮次')
    expect(describeTerminationReason('demo_preview')).toBe('示例预览')
    expect(describeTerminationReason(null)).toBeNull()
  })
})
