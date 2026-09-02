/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

interface LiteratureRecord {
  id: string
  title: string
  authors: string[]
  year: number
  doi?: string
  source_url: string
  kind: string
  topics: string[]
  annotation: string
  evidence_boundary: string
}

interface LiteratureCorpus {
  schema_version: number
  name: string
  freeze_target?: {
    minimum_records?: number
    maximum_records?: number
    current_status?: string
  }
  records: LiteratureRecord[]
}

function normalizeTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function duplicates(values: Array<[string, string]>): string[] {
  const firstId = new Map<string, string>()
  const found = new Set<string>()
  for (const [id, value] of values) {
    if (!value) continue
    const previous = firstId.get(value)
    if (previous) found.add(`${previous} <> ${id}: ${value}`)
    else firstId.set(value, id)
  }
  return [...found].sort()
}

function has(record: LiteratureRecord, pattern: RegExp): boolean {
  return pattern.test(`${record.kind} ${record.topics.join(' ')}`)
}

async function main() {
  const path = fileURLToPath(new URL('../sources/coronal-heating-corpus-v1.json', import.meta.url))
  const corpus = JSON.parse(await readFile(path, 'utf8')) as LiteratureCorpus
  const errors: string[] = []
  for (const [index, record] of corpus.records.entries()) {
    if (
      !record.id ||
      !record.title ||
      !record.kind ||
      !record.annotation ||
      !record.evidence_boundary
    ) {
      errors.push(`record ${index} is missing a required string`)
    }
    if (!Number.isInteger(record.year) || record.year < 1900 || record.year > 2100) {
      errors.push(`${record.id}: invalid year ${record.year}`)
    }
    if (!Array.isArray(record.authors) || record.authors.length === 0) {
      errors.push(`${record.id}: authors are required`)
    }
    if (!Array.isArray(record.topics) || record.topics.length < 2) {
      errors.push(`${record.id}: at least two retrieval topics are required`)
    }
    if (!record.source_url.startsWith('https://')) {
      errors.push(`${record.id}: source_url must use HTTPS`)
    }
  }

  const duplicateIds = duplicates(corpus.records.map((record) => [record.id, record.id]))
  const duplicateTitles = duplicates(
    corpus.records.map((record) => [record.id, normalizeTitle(record.title)]),
  )
  const duplicateDois = duplicates(
    corpus.records.map((record) => [record.id, record.doi?.toLocaleLowerCase() ?? '']),
  )
  if (duplicateIds.length) errors.push(...duplicateIds.map((item) => `duplicate id: ${item}`))
  if (duplicateTitles.length)
    errors.push(...duplicateTitles.map((item) => `duplicate title: ${item}`))
  if (duplicateDois.length) errors.push(...duplicateDois.map((item) => `duplicate DOI: ${item}`))

  const layers = {
    foundationalReviewOrTheory: corpus.records.filter((record) =>
      has(record, /foundational|review|framework|theory/i),
    ).length,
    discriminatingObservation: corpus.records.filter((record) =>
      has(
        record,
        /observation|constraint|diagnostic|spectroscop|survey|event-statistics|positive-control/i,
      ),
    ).length,
    forwardModelOrSimulation: corpus.records.filter((record) =>
      has(record, /forward.model|simulation|3d mhd|hydrodynamic|synthetic|mechanism model/i),
    ).length,
    counterexampleAlternativeOrLimit: corpus.records.filter((record) =>
      has(record, /counterexample|alternative|boundary|limitation|uncertainty/i),
    ).length,
  }
  const mechanisms = {
    wave: corpus.records.filter((record) => has(record, /wave|alfv[eé]n|波/iu)).length,
    reconnectionNanoflare: corpus.records.filter((record) =>
      has(record, /reconnection|nanoflare|magnetic braiding|current sheet|重联|纳耀斑/iu),
    ).length,
    thermalProcessAndAlternatives: corpus.records.filter((record) =>
      has(record, /thermal|cooling|steady heating|dem|热|冷却/iu),
    ).length,
  }
  const minimum = corpus.freeze_target?.minimum_records ?? 80
  const maximum = corpus.freeze_target?.maximum_records ?? 150
  const coverageReady =
    layers.foundationalReviewOrTheory >= 10 &&
    layers.discriminatingObservation >= 20 &&
    layers.forwardModelOrSimulation >= 15 &&
    layers.counterexampleAlternativeOrLimit >= 10 &&
    mechanisms.wave >= 15 &&
    mechanisms.reconnectionNanoflare >= 15 &&
    mechanisms.thermalProcessAndAlternatives >= 15
  const freezeReady =
    errors.length === 0 &&
    corpus.records.length >= minimum &&
    corpus.records.length <= maximum &&
    coverageReady

  const report = {
    corpus: corpus.name,
    recordCount: corpus.records.length,
    targetRange: [minimum, maximum],
    remainingToMinimum: Math.max(0, minimum - corpus.records.length),
    layers,
    mechanisms,
    unique: {
      ids: duplicateIds.length === 0,
      titles: duplicateTitles.length === 0,
      dois: duplicateDois.length === 0,
    },
    metadataValid: errors.length === 0,
    coverageReady,
    freezeReady,
    declaredStatus: corpus.freeze_target?.current_status ?? 'not_declared',
    errors,
  }
  console.log(JSON.stringify(report, null, 2))

  if (errors.length > 0 || (process.argv.includes('--require-freeze-ready') && !freezeReady)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
