import { asc, eq, max } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { runChunks } from '../schema/project.ts'

export async function appendRunChunk(
  projectName: string,
  runId: string,
  seq: number,
  chunkJson: string,
) {
  const { db } = createProjectDb(projectName)
  return db.transaction((tx) => {
    const currentMaximum = tx
      .select({ value: max(runChunks.seq) })
      .from(runChunks)
      .where(eq(runChunks.runId, runId))
      .all()[0]?.value
    const resolvedSeq =
      currentMaximum !== null && currentMaximum !== undefined
        ? Math.max(seq, currentMaximum + 1)
        : seq
    tx.insert(runChunks).values({ runId, seq: resolvedSeq, chunkJson }).run()
    return resolvedSeq
  })
}

export async function getRunChunks(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  return db
    .select({ seq: runChunks.seq, chunkJson: runChunks.chunkJson })
    .from(runChunks)
    .where(eq(runChunks.runId, runId))
    .orderBy(asc(runChunks.seq))
    .all()
}
