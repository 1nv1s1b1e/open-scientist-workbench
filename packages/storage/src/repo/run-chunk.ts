import { asc, eq } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { runChunks } from '../schema/project.ts'

export async function appendRunChunk(
  projectName: string,
  runId: string,
  seq: number,
  chunkJson: string,
) {
  const { db } = createProjectDb(projectName)
  db.insert(runChunks).values({ runId, seq, chunkJson }).run()
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
