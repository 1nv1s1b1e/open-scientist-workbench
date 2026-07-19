import { fileURLToPath } from 'node:url'

export * from './discover.ts'
export * from './load-tool.ts'
export * from './prompt.ts'
export * from './sandbox.ts'

export const DEFAULT_SKILLS_DIR = fileURLToPath(new URL('./defaults', import.meta.url))
