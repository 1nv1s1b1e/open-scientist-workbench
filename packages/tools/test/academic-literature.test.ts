import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { searchFreeAcademicLiterature } from '../src/academic-literature.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function cacheDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'open-scientist-literature-'))
  directories.push(directory)
  return directory
}

function successfulFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.hostname === 'api.openalex.org') {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'https://openalex.org/W1',
              title: 'Coronal heating by waves',
              authorships: [{ author: { display_name: 'A. Solar' } }],
              publication_year: 2025,
              doi: 'https://doi.org/10.1000/coronal.1',
              primary_location: { landing_page_url: 'https://example.test/openalex' },
              abstract_inverted_index: { Wave: [0], heating: [1], test: [2] },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({
        message: {
          items: [
            {
              DOI: '10.1000/CORONAL.1',
              title: ['Coronal heating by waves'],
              author: [{ given: 'A.', family: 'Solar' }],
              published: { 'date-parts': [[2025]] },
              URL: 'https://doi.org/10.1000/coronal.1',
              abstract: '<jats:p>A longer independent metadata abstract.</jats:p>',
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
}

describe('free academic literature federation', () => {
  it('merges OpenAlex and Crossref by DOI and retains provider provenance', async () => {
    const result = await searchFreeAcademicLiterature('solar coronal heating', {
      cacheDir: cacheDirectory(),
      fetchImpl: successfulFetch(),
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })

    expect(result.cacheStatus).toBe('updated')
    expect(result.providersSucceeded).toEqual(['openalex', 'crossref'])
    expect(result.papers).toHaveLength(1)
    expect(result.papers[0]).toEqual(
      expect.objectContaining({
        doi: '10.1000/coronal.1',
        providers: ['openalex', 'crossref'],
        cached: false,
      }),
    )
    expect(result.papers[0]?.sourceId).toMatch(/^paper:\d+$/)
  })

  it('replays a fresh cache without another network request', async () => {
    const cacheDir = cacheDirectory()
    let calls = 0
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      calls += 1
      return successfulFetch()(...args)
    }) as typeof fetch
    await searchFreeAcademicLiterature('solar coronal heating', {
      cacheDir,
      fetchImpl,
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })
    const replay = await searchFreeAcademicLiterature('solar coronal heating', {
      cacheDir,
      fetchImpl,
      now: () => new Date('2026-08-24T10:01:00.000Z'),
    })

    expect(calls).toBe(2)
    expect(replay.cacheStatus).toBe('fresh')
    expect(replay.papers[0]?.cached).toBe(true)
  })

  it('falls back to a stale snapshot when every provider is unavailable', async () => {
    const cacheDir = cacheDirectory()
    await searchFreeAcademicLiterature('solar coronal heating', {
      cacheDir,
      fetchImpl: successfulFetch(),
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })
    const unavailable = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    const replay = await searchFreeAcademicLiterature('solar coronal heating', {
      cacheDir,
      cacheTtlMs: 1,
      fetchImpl: unavailable,
      now: () => new Date('2026-08-24T11:00:00.000Z'),
    })

    expect(replay.cacheStatus).toBe('stale_fallback')
    expect(replay.papers).toHaveLength(1)
    expect(replay.warnings.join(' ')).toContain('全部在线服务失败')
  })

  it('re-ranks query-specific mechanism papers ahead of broad coronal matches', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.hostname === 'api.openalex.org') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W-general',
                title: 'A general survey of coronal holes',
                publication_year: 2024,
                authorships: [],
              },
              {
                id: 'https://openalex.org/W-specific',
                title: 'Alfvén wave dissipation and nanoflare reconnection diagnostics',
                publication_year: 2025,
                authorships: [],
                abstract_inverted_index: {
                  observational: [0],
                  predictions: [1],
                  distinguish: [2],
                  coronal: [3],
                  heating: [4],
                },
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
    }) as typeof fetch

    const result = await searchFreeAcademicLiterature(
      'Alfvén wave dissipation nanoflare reconnection coronal heating observational predictions distinguish',
      {
        cacheDir: cacheDirectory(),
        fetchImpl,
      },
    )

    expect(result.papers.map((paper) => paper.title)).toEqual([
      'Alfvén wave dissipation and nanoflare reconnection diagnostics',
      'A general survey of coronal holes',
    ])
  })
})
