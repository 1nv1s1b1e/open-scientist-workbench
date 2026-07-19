import { getWorkspaceDir } from '@open-scientist/config'
import { createBashTool } from 'bash-tool'

export async function createBashToolForHypothesis(project: string, hypoId: string) {
  return createBashTool({
    destination: getWorkspaceDir(project, hypoId),
  })
}
