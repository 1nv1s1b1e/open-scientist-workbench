import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { getProjectDir } from '@open-scientist/config'
import { ProjectNameSchema } from '@open-scientist/schema'
import { getProject, listArtifacts } from '@open-scientist/storage'
import { Hono } from 'hono'

export const artifacts = new Hono()

artifacts.get('/api/projects/:project/artifacts/:artifactId/content', async (c) => {
  const projectName = ProjectNameSchema.parse(c.req.param('project'))
  const project = await getProject(projectName)
  if (!project) {
    return c.json({ error: 'not_found', message: `Project "${projectName}" not found` }, 404)
  }
  const artifactId = c.req.param('artifactId')
  const artifact = (await listArtifacts(projectName, { limit: 500 })).find(
    (item) => item.artifactId === artifactId,
  )
  if (!artifact) {
    return c.json({ error: 'not_found', message: `Artifact "${artifactId}" not found` }, 404)
  }
  const projectRoot = resolve(getProjectDir(projectName))
  const artifactPath = resolve(artifact.path)
  const withinProject = relative(projectRoot, artifactPath)
  if (withinProject.startsWith('..') || resolve(projectRoot, withinProject) !== artifactPath) {
    return c.json(
      { error: 'forbidden', message: 'Artifact path is outside the project directory' },
      403,
    )
  }
  const bytes = await readFile(artifactPath)
  c.header('Content-Type', artifact.mediaType ?? 'application/octet-stream')
  c.header('Content-Length', String(bytes.length))
  c.header('Cache-Control', 'private, max-age=60')
  return c.body(bytes)
})
