import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getDefaultExploreTools,
  getDefaultLibrarianTools,
  getDefaultLookerTools,
  getDefaultOracleTools,
  getDefaultPrometheusTools,
  getDefaultSisyphusTools,
} from '../src/index.js'

const PROJECT = 'tools-test-project'
const HYPO = 'h1'

describe('getDefaultXxxTools toolset keys', () => {
  beforeEach(() => {
    process.env.BASE_DIR = `/tmp/open-scientist-agents-tools-${Date.now()}`
  })

  afterEach(() => {
    delete process.env.BASE_DIR
  })

  it('sisyphus → {review_leading_hypothesis}', async () => {
    const tools = await getDefaultSisyphusTools()
    expect(Object.keys(tools).sort()).toEqual(['review_leading_hypothesis'])
  })

  it('librarian → helix + bash + loadSkill', async () => {
    const tools = await getDefaultLibrarianTools(PROJECT)
    expect(Object.keys(tools).sort()).toEqual(
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

  it('explore → bash + loadSkill', async () => {
    const tools = await getDefaultExploreTools(PROJECT, HYPO)
    expect(Object.keys(tools).sort()).toEqual(['bash', 'loadSkill', 'readFile', 'writeFile'])
  })

  it('oracle → helix critique + bash + loadSkill', async () => {
    const tools = await getDefaultOracleTools(PROJECT)
    expect(Object.keys(tools).sort()).toEqual(
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

  it('looker → fitsAlign + helix evidence + bash + loadSkill', async () => {
    const tools = await getDefaultLookerTools(PROJECT, HYPO)
    expect(Object.keys(tools).sort()).toEqual(
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

  it('prometheus → mhdConfig + bash + loadSkill', async () => {
    const tools = await getDefaultPrometheusTools(PROJECT)
    expect(Object.keys(tools).sort()).toEqual([
      'bash',
      'loadSkill',
      'mhdConfig',
      'readFile',
      'writeFile',
    ])
  })
})
