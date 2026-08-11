import { desc, eq } from 'drizzle-orm'
import { MemoryEntrySchema, type MemoryEntry } from '@open-scientist/schema'
import { createProjectDb } from '../db.ts'
import { memoryEntries } from '../schema/project.ts'

function fromRow(row: typeof memoryEntries.$inferSelect): MemoryEntry {
  return MemoryEntrySchema.parse({
    memoryId: row.id,
    layer: row.layer,
    kind: row.kind,
    summary: row.summary,
    ...(row.content ? { content: row.content } : {}),
    namespace: JSON.parse(row.namespaceJson) as string[],
    tags: JSON.parse(row.tagsJson) as string[],
    sourceIds: JSON.parse(row.sourceIdsJson) as string[],
    hypothesisIds: JSON.parse(row.hypothesisIdsJson) as string[],
    evidenceIds: JSON.parse(row.evidenceIdsJson) as string[],
    taskIds: JSON.parse(row.taskIdsJson) as string[],
    artifactIds: JSON.parse(row.artifactIdsJson) as string[],
    processingRunIds: JSON.parse(row.processingRunIdsJson) as string[],
    triggeredBy: JSON.parse(row.triggeredByJson) as string[],
    verificationStatus: row.verificationStatus,
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(row.phenomenonId ? { phenomenonId: row.phenomenonId } : {}),
    projectId: row.projectId,
    runId: row.runId,
    round: row.round,
    fingerprint: row.fingerprint,
    utility: row.utility,
    createdAt: row.createdAt,
  })
}

export async function createMemoryEntry(projectName: string, entry: MemoryEntry) {
  const parsed = MemoryEntrySchema.parse(entry)
  const { db } = createProjectDb(projectName)
  db.insert(memoryEntries)
    .values({
      id: parsed.memoryId,
      projectId: parsed.projectId,
      runId: parsed.runId,
      round: parsed.round,
      layer: parsed.layer,
      kind: parsed.kind,
      summary: parsed.summary,
      content: parsed.content ?? null,
      namespaceJson: JSON.stringify(parsed.namespace),
      tagsJson: JSON.stringify(parsed.tags),
      sourceIdsJson: JSON.stringify(parsed.sourceIds),
      hypothesisIdsJson: JSON.stringify(parsed.hypothesisIds),
      evidenceIdsJson: JSON.stringify(parsed.evidenceIds),
      taskIdsJson: JSON.stringify(parsed.taskIds),
      artifactIdsJson: JSON.stringify(parsed.artifactIds),
      processingRunIdsJson: JSON.stringify(parsed.processingRunIds),
      triggeredByJson: JSON.stringify(parsed.triggeredBy),
      verificationStatus: parsed.verificationStatus,
      agentId: parsed.agentId ?? null,
      phenomenonId: parsed.phenomenonId ?? null,
      fingerprint: parsed.fingerprint,
      utility: parsed.utility,
      createdAt: parsed.createdAt,
    })
    .run()
  return parsed
}

export async function listMemoryEntries(
  projectName: string,
  options?: { runId?: string; round?: number; limit?: number },
): Promise<MemoryEntry[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(memoryEntries).orderBy(desc(memoryEntries.round)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  if (options?.round !== undefined) rows = rows.filter((row) => row.round <= options.round!)
  const limit = options?.limit ?? 20
  return rows.slice(0, limit).map(fromRow)
}

export async function findMemoryByFingerprint(projectName: string, fingerprint: string) {
  const { db } = createProjectDb(projectName)
  const row = db
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.fingerprint, fingerprint))
    .all()[0]
  return row ? fromRow(row) : null
}
