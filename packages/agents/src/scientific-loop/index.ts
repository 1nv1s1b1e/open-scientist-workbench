export { scientificLoopWorkflow } from './workflow.ts'
export type { ScientificLoopWorkflowInput } from './workflow.ts'
export {
  createScientificLoopGraph,
  runScientificLoopGraph,
} from './scientific-graph.ts'
export type { ScientificGraphResult } from './scientific-graph.ts'
export type {
  ScientificGraphDependencies,
  ScientificGraphInput,
  HypothesisGenerationContext,
  EvidenceWorkgroupContext,
  SynthesisContext,
  PlanningContext,
} from './services.ts'
export { createDefaultScientificDependencies } from './default-services.ts'
export * from './evidence-workgroup.ts'
export * from './evidence-subgraph.ts'
export * from './context-builder.ts'
export * from './context-policy.ts'
export * from './evidence-promotion.ts'
export * from './memory-policy.ts'
export {
  deduplicateValidationTasks,
  decideNextRoute,
  shouldContinueScientificLoop,
  summarizeEvidence,
} from './loop-logic.ts'
