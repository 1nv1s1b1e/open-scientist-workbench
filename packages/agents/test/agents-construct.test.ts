import type { ModelArg } from '@open-scientist/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createExploreAgent,
  createLibrarianAgent,
  createLookerAgent,
  createOracleAgent,
  createPrometheusAgent,
  createSisyphusAgent,
} from '../src/index.ts'

/**
 * Serializable `ModelArg` fixture for agent-construction tests.
 *
 * `createXxxAgent` reconstructs a `LanguageModel` via `createModelFromConfig`,
 * which dispatches to the OpenAI provider factory → `createOpenAI({ apiKey,
 * baseURL }).chat(model)`. The factory only needs a syntactically-valid config
 * to BUILD the model handle; no network call happens at construction time
 * (none of these tests invoke `agent.stream()`). The `baseURL` is a dummy that
 * is never hit.
 */
function fakeModelConfig(): ModelArg {
  return {
    provider: 'openai',
    model: 'test-model',
    baseURL: 'http://test.invalid',
    apiKey: 'sk-test',
    thinkingLevel: 'medium',
  }
}

const PROJECT = 'construct-test-project'
const HYPO = 'h1'

describe('agent construction', () => {
  beforeEach(() => {
    process.env.BASE_DIR = `/tmp/open-scientist-agents-construct-${Date.now()}`
  })

  afterEach(() => {
    delete process.env.BASE_DIR
  })

  it('constructs sisyphus agent with id + tools', async () => {
    const agent = await createSisyphusAgent({ modelConfig: fakeModelConfig() })
    expect(agent.id).toBe('sisyphus')
    expect(Object.keys(agent.tools).sort()).toEqual(['review_leading_hypothesis'])
  })

  it('constructs librarian agent with id + tools', async () => {
    const agent = await createLibrarianAgent({ modelConfig: fakeModelConfig(), projectId: PROJECT })
    expect(agent.id).toBe('librarian')
    expect(Object.keys(agent.tools).sort()).toEqual(
      [
        'addHypothesis',
        'bash',
        'loadSkill',
        'readFile',
        'searchHypotheses',
        'searchPapers',
        'writeFile',
      ].sort(),
    )
  })

  it('constructs explore agent with id + tools', async () => {
    const agent = await createExploreAgent({
      modelConfig: fakeModelConfig(),
      project: PROJECT,
      hypoId: HYPO,
    })
    expect(agent.id).toBe('explore')
    expect(Object.keys(agent.tools).sort()).toEqual(['bash', 'loadSkill', 'readFile', 'writeFile'])
  })

  it('constructs oracle agent with id + tools', async () => {
    const agent = await createOracleAgent({ modelConfig: fakeModelConfig(), projectId: PROJECT })
    expect(agent.id).toBe('oracle')
    expect(Object.keys(agent.tools).sort()).toEqual(
      [
        'addCritique',
        'addMutationLink',
        'bash',
        'getCritiquesByHypothesis',
        'loadSkill',
        'readFile',
        'writeFile',
      ].sort(),
    )
  })

  it('constructs looker agent with id + tools', async () => {
    const agent = await createLookerAgent({
      modelConfig: fakeModelConfig(),
      project: PROJECT,
      hypoId: HYPO,
    })
    expect(agent.id).toBe('looker')
    expect(Object.keys(agent.tools).sort()).toEqual(
      [
        'addEvidence',
        'bash',
        'fitsAlign',
        'getEvidenceByHypothesis',
        'loadSkill',
        'readFile',
        'writeFile',
      ].sort(),
    )
  })

  it('constructs prometheus agent with id + tools', async () => {
    const agent = await createPrometheusAgent({
      modelConfig: fakeModelConfig(),
      projectId: PROJECT,
    })
    expect(agent.id).toBe('prometheus')
    expect(Object.keys(agent.tools).sort()).toEqual([
      'bash',
      'loadSkill',
      'mhdConfig',
      'readFile',
      'writeFile',
    ])
  })

  it('sisyphus tool keys are exactly the orchestrator-only set', async () => {
    const agent = await createSisyphusAgent({ modelConfig: fakeModelConfig() })
    // Sisyphus is a pure orchestrator — no bash / helix / file tools.
    expect(agent.tools).not.toHaveProperty('bash')
    expect(agent.tools).not.toHaveProperty('loadSkill')
  })

  it('override tools replace default toolset', async () => {
    const custom = { customTool: { description: 'x', inputSchema: { _type: 'object' } } }
    const agent = await createSisyphusAgent({
      modelConfig: fakeModelConfig(),
      tools: custom as never,
    })
    expect(Object.keys(agent.tools)).toEqual(['customTool'])
  })
})
