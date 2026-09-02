import { describe, expect, it } from 'vite-plus/test'
import { buildLibrarianPrompt } from '../src/librarian/workflow.ts'

describe('buildLibrarianPrompt', () => {
  it('requires scientific fields that make a hypothesis falsifiable', () => {
    const prompt = buildLibrarianPrompt({
      seed: 'compare coronal-heating mechanisms',
      runId: 'run-1',
    })

    expect(prompt).toContain('所有自然语言输出必须使用中文')
    expect(prompt).toContain('mechanism')
    expect(prompt).toContain('predictions')
    expect(prompt).toContain('falsificationConditions')
    expect(prompt).toContain('sourceIds')
    expect(prompt).toContain('不得编造')
    expect(prompt).not.toContain('Seed question:')
  })

  it('binds filter generation to the configured dataset manifest path', () => {
    const prompt = buildLibrarianPrompt({
      seed: 'coronal heating',
      runId: 'run-1',
      datasetDir: 'C:\\data\\jwfd',
    })

    expect(prompt).toContain('C:\\data\\jwfd\\dataset_manifest.json')
  })

  it('uses an open-world mechanism space instead of a fixed mainstream trio', () => {
    const prompt = buildLibrarianPrompt({
      seed: 'AR11158 multiband heating',
      runId: 'run-open-world',
      scientific: true,
    })

    expect(prompt).toContain('开放世界候选生成')
    expect(prompt).toContain('不要求波动/重联/耦合三类必须出现')
    expect(prompt).toContain('检索到的机制族、已形成候选的机制族、尚未形成合格候选的机制族')
    expect(prompt).toContain('任何有限检索都不能声称穷尽全部物理可能性')
  })
})
