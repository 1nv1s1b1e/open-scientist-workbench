import { getWorkspaceDir } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import { createBashTool } from 'bash-tool'

const logger = createLogger('tools')

export async function createBashToolForHypothesis(project: string, hypoId: string) {
  const destination = getWorkspaceDir(project, hypoId)
  logger.info({ project, hypoId, destination }, 'createBashToolForHypothesis: creating bash tool')
  try {
    const toolkit = await createBashTool({ destination })
    logger.info(
      { project, hypoId, toolNames: Object.keys(toolkit.tools ?? {}) },
      'createBashToolForHypothesis: bash tool created',
    )
    return toolkit
  } catch (err) {
    logger.error(
      { project, hypoId, error: (err as Error).message },
      'createBashToolForHypothesis: failed to create bash tool',
    )
    throw err
  }
}
