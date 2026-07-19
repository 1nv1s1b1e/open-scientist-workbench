import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { plans } from '../schema/project.ts'

export async function addPlan(
  projectName: string,
  runId: string,
  data: {
    round: number
    searchParams: Record<string, unknown>
    mhdCfgPath?: string | null
    observationProposal?: string | null
  },
) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(plans)
    .values({
      id,
      runId,
      round: data.round,
      searchParamsJson: JSON.stringify(data.searchParams),
      mhdCfgPath: data.mhdCfgPath ?? null,
      observationProposal: data.observationProposal ?? null,
      createdAt: now,
    })
    .run()
  return { id, runId, ...data, createdAt: now }
}

export async function listPlans(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(plans).where(eq(plans.runId, runId)).all()
}
