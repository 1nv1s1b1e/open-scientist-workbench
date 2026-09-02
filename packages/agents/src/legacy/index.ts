/**
 * Legacy tournament-era multi-agent implementation (sisyphus / librarian-era
 * ToolLoopAgent roles). Archived, not deleted: the active scientific loop no
 * longer calls these workflows, but the tournament API route, saved runs and
 * frontend role keys still depend on these exports for compatibility.
 */
export * from './explore/index.ts'
export * from './looker/index.ts'
export * from './oracle/index.ts'
export * from './prometheus/index.ts'
export * from './sisyphus/index.ts'
