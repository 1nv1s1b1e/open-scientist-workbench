import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.js'
import { evidence } from '../schema/project.js'

export async function addEvidence(
  projectName: string,
  hypoId: string,
  data: { fitsPaths: string[]; videoClipPath?: string | null; metadata: Record<string, unknown> },
) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(evidence)
    .values({
      id,
      hypoId,
      fitsPathsJson: JSON.stringify(data.fitsPaths),
      videoClipPath: data.videoClipPath ?? null,
      metadataJson: JSON.stringify(data.metadata),
      createdAt: now,
    })
    .run()
  return { id, hypoId, ...data, createdAt: now }
}

export async function getEvidence(projectName: string, hypoId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(evidence).where(eq(evidence.hypoId, hypoId)).all()[0] ?? null
}
