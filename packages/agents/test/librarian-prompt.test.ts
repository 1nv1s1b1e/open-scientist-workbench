import { describe, expect, it } from 'vite-plus/test'
import { buildLibrarianPrompt } from '../src/librarian/workflow.ts'

describe('buildLibrarianPrompt', () => {
  it('requires scientific fields that make a hypothesis falsifiable', () => {
    const prompt = buildLibrarianPrompt({ seed: 'compare coronal-heating mechanisms', runId: 'run-1' })

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
})
