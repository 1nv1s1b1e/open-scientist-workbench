import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBaseDir } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'

const logger = createLogger('tools')
const CACHE_VERSION = 1
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type AcademicLiteratureProvider = 'openalex' | 'crossref'

export interface AcademicLiteratureRecord {
  id: number
  sourceId: string
  nativeId: string
  title: string
  abstract?: string
  authors: string[]
  year: number
  doi?: string
  sourceUrl: string
  providers: AcademicLiteratureProvider[]
  retrievedAt: string
  cached: boolean
}

export interface AcademicLiteratureSearchResult {
  query: string
  papers: AcademicLiteratureRecord[]
  providersAttempted: AcademicLiteratureProvider[]
  providersSucceeded: AcademicLiteratureProvider[]
  cacheStatus: 'fresh' | 'updated' | 'stale_fallback' | 'miss'
  warnings: string[]
}

interface AcademicLiteratureCache {
  version: number
  query: string
  fetchedAt: string
  providersSucceeded: AcademicLiteratureProvider[]
  papers: AcademicLiteratureRecord[]
}

export interface AcademicLiteratureSearchOptions {
  limit?: number
  onlineEnabled?: boolean
  cacheDir?: string
  cacheTtlMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
  providers?: AcademicLiteratureProvider[]
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(50, Math.trunc(value!)))
}

function stablePaperId(provider: AcademicLiteratureProvider, nativeId: string): number {
  const hex = createHash('sha256').update(`${provider}:${nativeId}`).digest('hex').slice(0, 12)
  // Keep online ids in a high, JSON-safe range that does not overlap the
  // hand-seeded local corpus ids (900001+).
  return 1_000_000_000_000 + Number.parseInt(hex, 16)
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && normalizeWhitespace(value)
    ? normalizeWhitespace(value)
    : undefined
}

function normalizedDoi(value: unknown): string | undefined {
  const text = optionalText(value)
  if (!text) return undefined
  return text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
}

function recordKey(record: Pick<AcademicLiteratureRecord, 'doi' | 'title'>): string {
  if (record.doi) return `doi:${record.doi}`
  return `title:${record.title
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')}`
}

const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'observational',
  'results',
])

function searchTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLocaleLowerCase()
        .normalize('NFKC')
        .split(/[^\p{L}\p{N}]+/gu)
        .filter((token) => token.length >= 3 && !SEARCH_STOP_WORDS.has(token)),
    ),
  ]
}

/**
 * Public scholarly search endpoints occasionally rank a broad lexical match
 * ahead of a mechanism-discriminating paper. Re-rank the federated snapshot
 * locally so repeated/offline runs retain the same query-specific ordering.
 */
function literatureRelevance(record: AcademicLiteratureRecord, query: string): number {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return 0
  const title = record.title.toLocaleLowerCase().normalize('NFKC')
  const abstract = record.abstract?.toLocaleLowerCase().normalize('NFKC') ?? ''
  let titleHits = 0
  let abstractOnlyHits = 0
  for (const token of tokens) {
    if (title.includes(token)) titleHits += 1
    else if (abstract.includes(token)) abstractOnlyHits += 1
  }
  const coverage = (titleHits + abstractOnlyHits) / tokens.length
  return titleHits * 3 + abstractOnlyHits + coverage
}

function abstractFromInvertedIndex(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const positioned: Array<[number, string]> = []
  for (const [token, positions] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue
    for (const position of positions) {
      if (typeof position === 'number' && Number.isInteger(position) && position >= 0) {
        positioned.push([position, token])
      }
    }
  }
  positioned.sort((left, right) => left[0] - right[0])
  const text = normalizeWhitespace(positioned.map(([, token]) => token).join(' '))
  return text || undefined
}

function yearFromDateParts(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined
  const first = value[0]
  if (!Array.isArray(first) || typeof first[0] !== 'number') return undefined
  return Number.isInteger(first[0]) ? first[0] : undefined
}

function validYear(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1500 && value <= 2200
    ? value
    : 0
}

async function fetchJson(fetchImpl: typeof fetch, url: URL, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'open-scientist-literature/1.0 (competition research workflow)',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function searchOpenAlex(
  query: string,
  limit: number,
  retrievedAt: string,
  fetchImpl: typeof fetch,
): Promise<AcademicLiteratureRecord[]> {
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('search', query)
  url.searchParams.set('per_page', String(limit))
  url.searchParams.set(
    'select',
    'id,title,display_name,authorships,publication_year,doi,primary_location,abstract_inverted_index',
  )
  const apiKey = process.env.OPENALEX_API_KEY?.trim()
  if (apiKey) url.searchParams.set('api_key', apiKey)
  const payload = (await fetchJson(fetchImpl, url, 10_000)) as { results?: unknown[] }
  return (payload.results ?? []).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    const nativeId = optionalText(row.id)
    const title = optionalText(row.title) ?? optionalText(row.display_name)
    if (!nativeId || !title) return []
    const authorships = Array.isArray(row.authorships) ? row.authorships : []
    const authors = authorships.flatMap((authorship) => {
      if (!authorship || typeof authorship !== 'object' || Array.isArray(authorship)) return []
      const author = (authorship as Record<string, unknown>).author
      if (!author || typeof author !== 'object' || Array.isArray(author)) return []
      const name = optionalText((author as Record<string, unknown>).display_name)
      return name ? [name] : []
    })
    const doi = normalizedDoi(row.doi)
    const primaryLocation =
      row.primary_location && typeof row.primary_location === 'object'
        ? (row.primary_location as Record<string, unknown>)
        : null
    const landingPage = optionalText(primaryLocation?.landing_page_url)
    const record: AcademicLiteratureRecord = {
      id: stablePaperId('openalex', nativeId),
      sourceId: `paper:${stablePaperId('openalex', nativeId)}`,
      nativeId,
      title,
      authors,
      year: validYear(row.publication_year),
      sourceUrl: landingPage ?? (doi ? `https://doi.org/${doi}` : nativeId),
      providers: ['openalex'],
      retrievedAt,
      cached: false,
    }
    const abstract = abstractFromInvertedIndex(row.abstract_inverted_index)
    if (abstract) record.abstract = abstract
    if (doi) record.doi = doi
    return [record]
  })
}

async function searchCrossref(
  query: string,
  limit: number,
  retrievedAt: string,
  fetchImpl: typeof fetch,
): Promise<AcademicLiteratureRecord[]> {
  const url = new URL('https://api.crossref.org/works')
  url.searchParams.set('query.bibliographic', query)
  url.searchParams.set('rows', String(limit))
  url.searchParams.set(
    'select',
    'DOI,title,author,published-print,published-online,published,URL,abstract',
  )
  const mailto = process.env.CROSSREF_MAILTO?.trim()
  if (mailto) url.searchParams.set('mailto', mailto)
  const payload = (await fetchJson(fetchImpl, url, 10_000)) as {
    message?: { items?: unknown[] }
  }
  return (payload.message?.items ?? []).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    const doi = normalizedDoi(row.DOI)
    const nativeId = doi ?? optionalText(row.URL)
    const titleValue = Array.isArray(row.title) ? row.title[0] : row.title
    const title = optionalText(titleValue)
    if (!nativeId || !title) return []
    const authorRows = Array.isArray(row.author) ? row.author : []
    const authors = authorRows.flatMap((author) => {
      if (!author || typeof author !== 'object' || Array.isArray(author)) return []
      const item = author as Record<string, unknown>
      const name = normalizeWhitespace(
        [optionalText(item.given), optionalText(item.family)].filter(Boolean).join(' '),
      )
      return name ? [name] : []
    })
    const printYear = yearFromDateParts(
      (row['published-print'] as Record<string, unknown> | undefined)?.['date-parts'],
    )
    const onlineYear = yearFromDateParts(
      (row['published-online'] as Record<string, unknown> | undefined)?.['date-parts'],
    )
    const genericYear = yearFromDateParts(
      (row.published as Record<string, unknown> | undefined)?.['date-parts'],
    )
    const record: AcademicLiteratureRecord = {
      id: stablePaperId('crossref', nativeId),
      sourceId: `paper:${stablePaperId('crossref', nativeId)}`,
      nativeId,
      title,
      authors,
      year: validYear(printYear ?? onlineYear ?? genericYear),
      sourceUrl: optionalText(row.URL) ?? (doi ? `https://doi.org/${doi}` : nativeId),
      providers: ['crossref'],
      retrievedAt,
      cached: false,
    }
    const abstract = optionalText(row.abstract)
    if (abstract) record.abstract = abstract
    if (doi) record.doi = doi
    return [record]
  })
}

function mergeRecords(records: readonly AcademicLiteratureRecord[], query: string, limit: number) {
  const merged = new Map<string, AcademicLiteratureRecord>()
  for (const record of records) {
    const key = recordKey(record)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, record)
      continue
    }
    merged.set(key, {
      ...existing,
      abstract:
        (record.abstract?.length ?? 0) > (existing.abstract?.length ?? 0)
          ? record.abstract
          : existing.abstract,
      authors: [...new Set([...existing.authors, ...record.authors])],
      year: existing.year || record.year,
      doi: existing.doi ?? record.doi,
      sourceUrl: existing.sourceUrl || record.sourceUrl,
      providers: [...new Set([...existing.providers, ...record.providers])],
      cached: existing.cached && record.cached,
    })
  }
  return [...merged.values()]
    .map((record, insertionIndex) => ({
      record,
      insertionIndex,
      relevance: literatureRelevance(record, query),
    }))
    .sort(
      (left, right) =>
        right.relevance - left.relevance || left.insertionIndex - right.insertionIndex,
    )
    .map(({ record }) => record)
    .slice(0, limit)
}

function cacheFile(query: string, cacheDir: string): string {
  const key = createHash('sha256').update(query.toLocaleLowerCase().normalize('NFKC')).digest('hex')
  return join(cacheDir, `${key}.json`)
}

async function readCache(path: string): Promise<AcademicLiteratureCache | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as AcademicLiteratureCache
    return value.version === CACHE_VERSION && Array.isArray(value.papers) ? value : null
  } catch {
    return null
  }
}

async function writeCache(path: string, value: AcademicLiteratureCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, path)
}

function enabledByEnvironment(): boolean {
  return !/^(?:0|false|off|no)$/i.test(process.env.LITERATURE_ONLINE_ENABLED?.trim() ?? 'true')
}

/**
 * Search keyless/free scholarly metadata APIs with an on-disk replay cache.
 * Network failures never erase the last successful snapshot and never turn a
 * paper into empirical support; callers receive bibliographic candidates only.
 */
export async function searchFreeAcademicLiterature(
  query: string,
  options: AcademicLiteratureSearchOptions = {},
): Promise<AcademicLiteratureSearchResult> {
  const normalizedQuery = normalizeWhitespace(query)
  if (!normalizedQuery) throw new Error('academic literature query must not be empty')
  const limit = boundedLimit(options.limit)
  const now = options.now?.() ?? new Date()
  const retrievedAt = now.toISOString()
  const cacheDir = options.cacheDir ?? join(getBaseDir(), 'literature-cache')
  const path = cacheFile(normalizedQuery, cacheDir)
  const cached = await readCache(path)
  const age = cached
    ? now.getTime() - new Date(cached.fetchedAt).getTime()
    : Number.POSITIVE_INFINITY
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  if (cached && Number.isFinite(age) && age >= 0 && age <= ttl) {
    return {
      query: normalizedQuery,
      papers: cached.papers.slice(0, limit).map((paper) => ({ ...paper, cached: true })),
      providersAttempted: [],
      providersSucceeded: cached.providersSucceeded,
      cacheStatus: 'fresh',
      warnings: [],
    }
  }

  const onlineEnabled = options.onlineEnabled ?? enabledByEnvironment()
  const providers = options.providers ?? ['openalex', 'crossref']
  if (!onlineEnabled) {
    return {
      query: normalizedQuery,
      papers: (cached?.papers ?? []).slice(0, limit).map((paper) => ({ ...paper, cached: true })),
      providersAttempted: [],
      providersSucceeded: cached?.providersSucceeded ?? [],
      cacheStatus: cached ? 'stale_fallback' : 'miss',
      warnings: [
        cached
          ? '在线文献检索已关闭，使用最后一次缓存快照。'
          : '在线文献检索已关闭且没有可用缓存。',
      ],
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const warnings: string[] = []
  const succeeded: AcademicLiteratureProvider[] = []
  const resultsByProvider = new Map<AcademicLiteratureProvider, AcademicLiteratureRecord[]>()
  // Query providers sequentially. This respects Crossref's public concurrency
  // guidance and keeps one agent run from causing a metadata-API request burst.
  for (const provider of providers) {
    try {
      const rows =
        provider === 'openalex'
          ? await searchOpenAlex(normalizedQuery, limit, retrievedAt, fetchImpl)
          : await searchCrossref(normalizedQuery, limit, retrievedAt, fetchImpl)
      resultsByProvider.set(provider, rows)
      succeeded.push(provider)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`${provider} 检索失败：${message}`)
      logger.warn({ provider, query: normalizedQuery, error: message }, 'academic API failed')
    }
  }

  if (succeeded.length === 0) {
    return {
      query: normalizedQuery,
      papers: (cached?.papers ?? []).slice(0, limit).map((paper) => ({ ...paper, cached: true })),
      providersAttempted: providers,
      providersSucceeded: cached?.providersSucceeded ?? [],
      cacheStatus: cached ? 'stale_fallback' : 'miss',
      warnings: [
        ...warnings,
        cached ? '全部在线服务失败，已回退到最后一次缓存快照。' : '全部在线服务失败且没有缓存。',
      ],
    }
  }

  const interleaved: AcademicLiteratureRecord[] = []
  const longest = Math.max(
    ...succeeded.map((provider) => resultsByProvider.get(provider)?.length ?? 0),
  )
  for (let index = 0; index < longest; index += 1) {
    for (const provider of succeeded) {
      const record = resultsByProvider.get(provider)?.[index]
      if (record) interleaved.push(record)
    }
  }
  const papers = mergeRecords(interleaved, normalizedQuery, limit)
  const snapshot: AcademicLiteratureCache = {
    version: CACHE_VERSION,
    query: normalizedQuery,
    fetchedAt: retrievedAt,
    providersSucceeded: succeeded,
    papers,
  }
  try {
    await writeCache(path, snapshot)
  } catch (error) {
    warnings.push(`文献缓存写入失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    query: normalizedQuery,
    papers,
    providersAttempted: providers,
    providersSucceeded: succeeded,
    cacheStatus: 'updated',
    warnings,
  }
}
