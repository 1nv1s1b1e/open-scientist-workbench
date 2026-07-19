import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.js'
import { critiques, mutations } from '../schema/project.js'

export async function addCritique(
  projectName: string,
  hypoId: string,
  data: { critiqueText: string; rationale: string; round: number },
) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(critiques)
    .values({ id, hypoId, ...data, createdAt: now })
    .run()
  return { id, hypoId, ...data, createdAt: now }
}

export async function addMutation(
  projectName: string,
  parentHypoId: string,
  childHypoId: string,
  data: { mutationRationale: string; round: number },
) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(mutations)
    .values({ id, parentHypoId, childHypoId, ...data, createdAt: now })
    .run()
  return { id, parentHypoId, childHypoId, ...data, createdAt: now }
}

export async function listCritiques(projectName: string, hypoId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(critiques).where(eq(critiques.hypoId, hypoId)).all()
}
