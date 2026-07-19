import { describe, expect, it } from 'vitest'
import {
  addCritiqueTool,
  addEvidenceTool,
  addHypothesisTool,
  addMutationLinkTool,
  addSnapshotTool,
  getCritiquesByHypothesisTool,
  getEvidenceByHypothesisTool,
  getEvolutionChainTool,
  getHypothesesByRoundTool,
  getHypothesisTool,
  getLeaderboardTool,
  getRelatedConceptsTool,
  searchHypothesesTool,
  searchPapersTool,
} from '../src/helix-query.ts'

// The AI SDK `tool({...})` factory exposes the zod schema as `.inputSchema` /
// `.outputSchema`. We cast to a minimal interface to drive `.parse()` without
// executing the tool (which would hit HelixDB).
interface ToolShape {
  inputSchema: { parse: (x: unknown) => unknown }
  outputSchema?: { parse: (x: unknown) => unknown }
}

function inputs(tool: unknown): ToolShape['inputSchema'] {
  return (tool as ToolShape).inputSchema
}
function outputs(tool: unknown): ToolShape['outputSchema'] | undefined {
  return (tool as ToolShape).outputSchema
}

const ISO = '2026-01-01T00:00:00.000Z'

describe('helix-query tool input schemas — happy paths', () => {
  it('searchPapers accepts query + default k', () => {
    const r = inputs(searchPapersTool).parse({ query: 'coronal heating' }) as {
      query: string
      k: number
    }
    expect(r.query).toBe('coronal heating')
    expect(r.k).toBe(10)
  })

  it('searchHypotheses accepts query + explicit k', () => {
    const r = inputs(searchHypothesesTool).parse({ query: 'nanoflare', k: 5 }) as { k: number }
    expect(r.k).toBe(5)
  })

  it('getHypothesis accepts a numeric id', () => {
    expect(inputs(getHypothesisTool).parse({ id: 42 })).toEqual({ id: 42 })
  })

  it('getHypothesis accepts a string id', () => {
    expect(inputs(getHypothesisTool).parse({ id: 'h-42' })).toEqual({ id: 'h-42' })
  })

  it('getEvidenceByHypothesis accepts a string hypoId', () => {
    expect(inputs(getEvidenceByHypothesisTool).parse({ hypoId: 'h1' })).toEqual({ hypoId: 'h1' })
  })

  it('getCritiquesByHypothesis accepts a numeric hypoId', () => {
    expect(inputs(getCritiquesByHypothesisTool).parse({ hypoId: 7 })).toEqual({ hypoId: 7 })
  })

  it('getRelatedConcepts accepts a hypoId', () => {
    expect(inputs(getRelatedConceptsTool).parse({ hypoId: 'h1' })).toEqual({ hypoId: 'h1' })
  })

  it('getLeaderboard accepts runId + default k', () => {
    const r = inputs(getLeaderboardTool).parse({ runId: 'run-1' }) as { runId: string; k: number }
    expect(r.runId).toBe('run-1')
    expect(r.k).toBe(10)
  })

  it('getEvolutionChain accepts a hypoId', () => {
    expect(inputs(getEvolutionChainTool).parse({ hypoId: 3 })).toEqual({ hypoId: 3 })
  })

  it('getHypothesesByRound accepts a nonnegative integer roundId', () => {
    expect(inputs(getHypothesesByRoundTool).parse({ roundId: 0 })).toEqual({ roundId: 0 })
  })

  it('addHypothesis accepts a full hypothesis payload', () => {
    const r = inputs(addHypothesisTool).parse({
      statement: 'AC heating dominates',
      roundId: 2,
      runId: 'run-1',
      f1Score: 0.83,
      createdAt: ISO,
    }) as { statement: string }
    expect(r.statement).toBe('AC heating dominates')
  })

  it('addEvidence accepts support type with optional videoPath', () => {
    const r = inputs(addEvidenceTool).parse({
      hypoId: 'h1',
      type: 'support',
      content: 'bright loop seen',
      f1Score: 0.9,
      fitsPaths: ['/a.fits'],
      createdAt: ISO,
    }) as { type: string }
    expect(r.type).toBe('support')
  })

  it('addCritique accepts a high-severity critique', () => {
    const r = inputs(addCritiqueTool).parse({
      hypoId: 1,
      content: 'counterexample found',
      severity: 'high',
      createdAt: ISO,
    }) as { severity: string }
    expect(r.severity).toBe('high')
  })

  it('addMutationLink accepts from + to ids + mutationType', () => {
    expect(
      inputs(addMutationLinkTool).parse({
        fromHypoId: 'h1',
        toHypoId: 'h2',
        mutationType: 'threshold',
      }),
    ).toEqual({ fromHypoId: 'h1', toHypoId: 'h2', mutationType: 'threshold' })
  })

  it('addSnapshot accepts a hypothesis id array of mixed types', () => {
    const r = inputs(addSnapshotTool).parse({
      roundId: 1,
      runId: 'run-1',
      hypothesisIds: ['h1', 2],
      createdAt: ISO,
    }) as { hypothesisIds: unknown[] }
    expect(r.hypothesisIds).toEqual(['h1', 2])
  })
})

describe('helix-query tool input schemas — throw paths', () => {
  it('searchPapers throws when query is missing', () => {
    expect(() => inputs(searchPapersTool).parse({ k: 5 })).toThrow()
  })

  it('searchPapers throws when k is not positive', () => {
    expect(() => inputs(searchPapersTool).parse({ query: 'x', k: 0 })).toThrow()
  })

  it('getHypothesis throws when id is a boolean', () => {
    expect(() => inputs(getHypothesisTool).parse({ id: true })).toThrow()
  })

  it('getHypothesis throws when id is missing', () => {
    expect(() => inputs(getHypothesisTool).parse({})).toThrow()
  })

  it('getLeaderboard throws when runId is missing', () => {
    expect(() => inputs(getLeaderboardTool).parse({ k: 5 })).toThrow()
  })

  it('getHypothesesByRound throws when roundId is negative', () => {
    expect(() => inputs(getHypothesesByRoundTool).parse({ roundId: -1 })).toThrow()
  })

  it('getHypothesesByRound throws when roundId is a float', () => {
    expect(() => inputs(getHypothesesByRoundTool).parse({ roundId: 1.5 })).toThrow()
  })

  it('addHypothesis throws when f1Score is missing', () => {
    expect(() =>
      inputs(addHypothesisTool).parse({ statement: 's', roundId: 1, runId: 'r', createdAt: ISO }),
    ).toThrow()
  })

  it('addEvidence throws when type is an illegal enum', () => {
    expect(() =>
      inputs(addEvidenceTool).parse({
        hypoId: 'h1',
        type: 'bogus',
        content: 'x',
        f1Score: 0.5,
        fitsPaths: [],
        createdAt: ISO,
      }),
    ).toThrow()
  })

  it('addCritique throws when severity is an illegal enum', () => {
    expect(() =>
      inputs(addCritiqueTool).parse({
        hypoId: 'h1',
        content: 'x',
        severity: 'catastrophic',
        createdAt: ISO,
      }),
    ).toThrow()
  })

  it('addMutationLink throws when mutationType is missing', () => {
    expect(() => inputs(addMutationLinkTool).parse({ fromHypoId: 'h1', toHypoId: 'h2' })).toThrow()
  })

  it('addSnapshot throws when hypothesisIds contains a boolean', () => {
    expect(() =>
      inputs(addSnapshotTool).parse({
        roundId: 1,
        runId: 'r',
        hypothesisIds: [true],
        createdAt: ISO,
      }),
    ).toThrow()
  })
})

describe('helix-query tool output schemas — happy paths', () => {
  it('searchPapers outputSchema parses a papers array', () => {
    const out = outputs(searchPapersTool)
    expect(out).toBeDefined()
    const r = out!.parse({
      papers: [{ id: 1, title: 't', authors: ['a'], year: 2024 }],
    }) as { papers: unknown[] }
    expect(r.papers).toHaveLength(1)
  })

  it('getHypothesis outputSchema parses a null hypothesis', () => {
    const out = outputs(getHypothesisTool)
    expect(out).toBeDefined()
    expect(out!.parse({ hypothesis: null })).toEqual({ hypothesis: null })
  })

  it('addHypothesis outputSchema parses {success: true}', () => {
    const out = outputs(addHypothesisTool)
    expect(out).toBeDefined()
    expect(out!.parse({ success: true })).toEqual({ success: true })
  })

  it('addEvidence outputSchema rejects {success: "yes"}', () => {
    const out = outputs(addEvidenceTool)
    expect(out).toBeDefined()
    expect(() => out!.parse({ success: 'yes' })).toThrow()
  })
})
