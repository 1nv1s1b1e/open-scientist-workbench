import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { addPaper, ensureIndexes, searchPapers } from '../packages/helix/src/index.ts'

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
  records: LiteratureRecord[]
}

function assertRecord(value: unknown, index: number): asserts value is LiteratureRecord {
  const record = value as Partial<LiteratureRecord> | null
  const requiredStrings = [
    record?.id,
    record?.title,
    record?.source_url,
    record?.kind,
    record?.annotation,
    record?.evidence_boundary,
  ]
  if (
    !record ||
    requiredStrings.some((field) => typeof field !== 'string' || field.trim().length === 0) ||
    !Array.isArray(record.authors) ||
    !record.authors.every((author) => typeof author === 'string' && author.trim().length > 0) ||
    !Array.isArray(record.topics) ||
    !record.topics.every((topic) => typeof topic === 'string' && topic.trim().length > 0) ||
    !Number.isInteger(record.year)
  ) {
    throw new Error('Invalid literature record at index ' + index)
  }
}

async function loadCorpus(): Promise<LiteratureCorpus> {
  const path = fileURLToPath(new URL('../sources/coronal-heating-corpus-v1.json', import.meta.url))
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<LiteratureCorpus>
  if (!parsed || parsed.schema_version !== 1 || !Array.isArray(parsed.records)) {
    throw new Error('Unsupported coronal-heating corpus format')
  }
  parsed.records.forEach(assertRecord)
  return parsed as LiteratureCorpus
}

function retrievalAnnotation(record: LiteratureRecord): string {
  return [
    '【文献类型】' + record.kind,
    '【主题】' + record.topics.join('；'),
    '【受控注释】' + record.annotation,
    '【证据边界】' + record.evidence_boundary,
    '【元数据来源】' + record.source_url,
  ].join('\n')
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

async function isAlreadySeeded(record: LiteratureRecord): Promise<boolean> {
  const candidates = await searchPapers(record.title, 25)
  return candidates.some(
    (candidate) =>
      candidate.title === record.title ||
      (record.doi != null && normalized(candidate.doi) === normalized(record.doi)),
  )
}

async function main() {
  const corpus = await loadCorpus()
  console.log('Ensuring indexes for ' + corpus.name + '...')
  await ensureIndexes()

  let added = 0
  let skipped = 0
  for (const record of corpus.records) {
    if (await isAlreadySeeded(record)) {
      skipped += 1
      console.log('  Already present: ' + record.title)
      continue
    }
    await addPaper({
      title: record.title,
      abstract: retrievalAnnotation(record),
      authors: record.authors,
      year: record.year,
      doi: record.doi,
    })
    added += 1
    console.log('  Added: ' + record.title)
  }

  const results = await searchPapers('coronal heating', 10)
  console.log('\nSeed complete: ' + added + ' added, ' + skipped + ' already present.')
  console.log('Verification search returned ' + results.length + ' paper(s):')
  for (const paper of results) console.log('  - [' + paper.year + '] ' + paper.title)
}

main().catch((error) => {
  console.error('Paper seed failed:', error)
  process.exit(1)
})
