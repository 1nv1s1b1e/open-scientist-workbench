import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RunnableConfig } from '@langchain/core/runnables'
import {
  MemorySaver,
  type BaseCheckpointSaver,
} from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { getProjectDir } from '@open-scientist/config'

export interface ScientificGraphRuntime {
  checkpointer: BaseCheckpointSaver
  config: (projectId: string, runId: string) => RunnableConfig
  close: () => void
}

export function scientificThreadId(projectId: string, runId: string): string {
  return projectId + ':' + runId
}

function config(projectId: string, runId: string): RunnableConfig {
  return {
    configurable: {
      thread_id: scientificThreadId(projectId, runId),
    },
    metadata: {
      projectId,
      runId,
      workflow: 'scientific-loop',
    },
  }
}

export function createInMemoryScientificRuntime(): ScientificGraphRuntime {
  return {
    checkpointer: new MemorySaver(),
    config,
    close: () => undefined,
  }
}

export function createSqliteScientificRuntime(
  connectionStringOrPath: string,
): ScientificGraphRuntime {
  const checkpointer = SqliteSaver.fromConnString(connectionStringOrPath)
  return {
    checkpointer,
    config,
    close: () => checkpointer.db.close(),
  }
}

export function scientificCheckpointPath(projectId: string): string {
  return join(getProjectDir(projectId), 'langgraph-checkpoints.sqlite')
}

export function createProjectScientificRuntime(
  projectId: string,
): ScientificGraphRuntime {
  const projectDir = getProjectDir(projectId)
  mkdirSync(projectDir, { recursive: true })
  return createSqliteScientificRuntime(scientificCheckpointPath(projectId))
}
