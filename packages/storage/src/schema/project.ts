import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: text('created_at').notNull(),
  configJson: text('config_json'),
})

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'awaiting_approval', 'completed', 'failed', 'stopped'],
  }).notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  currentRound: integer('current_round').notNull().default(0),
  bestF1: real('best_f1').notNull().default(0),
  workflowType: text('workflow_type', {
    enum: ['tournament', 'scientific-loop'],
  })
    .notNull()
    .default('tournament'),
  scientificStatus: text('scientific_status'),
  terminationReason: text('termination_reason'),
  configJson: text('config_json'),
  resultJson: text('result_json'),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  partsJson: text('parts_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const hypotheses = sqliteTable('hypotheses', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  parentId: text('parent_id'),
  round: integer('round').notNull(),
  statement: text('statement').notNull(),
  pythonCode: text('python_code').notNull(),
  f1: real('f1'),
  status: text('status', {
    enum: ['candidate', 'evaluated', 'critiqued', 'mutated', 'winner', 'eliminated'],
  }).notNull(),
  createdAt: text('created_at').notNull(),
})

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  hypoId: text('hypo_id').notNull(),
  fitsPathsJson: text('fits_paths_json').notNull(),
  videoClipPath: text('video_clip_path'),
  metadataJson: text('metadata_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const critiques = sqliteTable('critiques', {
  id: text('id').primaryKey(),
  hypoId: text('hypo_id').notNull(),
  critiqueText: text('critique_text').notNull(),
  rationale: text('rationale').notNull(),
  round: integer('round').notNull(),
  createdAt: text('created_at').notNull(),
})

export const mutations = sqliteTable('mutations', {
  id: text('id').primaryKey(),
  parentHypoId: text('parent_hypo_id').notNull(),
  childHypoId: text('child_hypo_id').notNull(),
  mutationRationale: text('mutation_rationale').notNull(),
  round: integer('round').notNull(),
  createdAt: text('created_at').notNull(),
})

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  round: integer('round').notNull(),
  searchParamsJson: text('search_params_json').notNull(),
  mhdCfgPath: text('mhd_cfg_path'),
  proposalPath: text('proposal_path'),
  createdAt: text('created_at').notNull(),
})

export const runChunks = sqliteTable(
  'run_chunks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    seq: integer('seq').notNull(),
    chunkJson: text('chunk_json').notNull(),
  },
  (table) => [uniqueIndex('run_chunks_run_id_seq_unique').on(table.runId, table.seq)],
)

export const memoryEntries = sqliteTable('memory_entries', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  round: integer('round').notNull(),
  layer: text('layer').notNull().default('episodic'),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  content: text('content'),
  namespaceJson: text('namespace_json').notNull().default('[]'),
  tagsJson: text('tags_json').notNull(),
  sourceIdsJson: text('source_ids_json').notNull(),
  hypothesisIdsJson: text('hypothesis_ids_json').notNull(),
  evidenceIdsJson: text('evidence_ids_json').notNull(),
  taskIdsJson: text('task_ids_json').notNull(),
  artifactIdsJson: text('artifact_ids_json').notNull().default('[]'),
  processingRunIdsJson: text('processing_run_ids_json').notNull().default('[]'),
  triggeredByJson: text('triggered_by_json').notNull().default('[]'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  agentId: text('agent_id'),
  phenomenonId: text('phenomenon_id'),
  fingerprint: text('fingerprint').notNull(),
  utility: real('utility').notNull().default(0.5),
  createdAt: text('created_at').notNull(),
})

export const dataSnapshots = sqliteTable('data_snapshots', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  sourceIdsJson: text('source_ids_json').notNull(),
  manifestPath: text('manifest_path').notNull(),
  checksumsJson: text('checksums_json').notNull(),
  selectionJson: text('selection_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const processingRuns = sqliteTable('processing_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  round: integer('round').notNull(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id'),
  triggeredBy: text('triggered_by').notNull(),
  snapshotIdsJson: text('snapshot_ids_json').notNull(),
  stepsJson: text('steps_json').notNull(),
  deterministic: integer('deterministic', { mode: 'boolean' }).notNull(),
  status: text('status').notNull(),
  outputArtifactIdsJson: text('output_artifact_ids_json').notNull(),
  metricsArtifactId: text('metrics_artifact_id'),
  limitationsJson: text('limitations_json').notNull(),
  fingerprint: text('fingerprint').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
})

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  kind: text('kind').notNull(),
  path: text('path').notNull(),
  checksum: text('checksum').notNull(),
  mediaType: text('media_type'),
  generatedBy: text('generated_by').notNull(),
  processingRunId: text('processing_run_id').notNull(),
  sourceIdsJson: text('source_ids_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const validationTasks = sqliteTable(
  'validation_tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    runId: text('run_id').notNull(),
    executorId: text('executor_id'),
    route: text('route').notNull(),
    type: text('type').notNull(),
    objective: text('objective').notNull(),
    hypothesisIdsJson: text('hypothesis_ids_json').notNull().default('[]'),
    predictionIdsJson: text('prediction_ids_json').notNull().default('[]'),
    falsificationConditionIdsJson: text('falsification_condition_ids_json').notNull().default('[]'),
    requiredSourceIdsJson: text('required_source_ids_json').notNull(),
    requiredDataJson: text('required_data_json').notNull().default('[]'),
    requiredFacilitiesJson: text('required_facilities_json').notNull().default('[]'),
    readiness: text('readiness'),
    expectedDuration: text('expected_duration'),
    estimatedStorageBytes: integer('estimated_storage_bytes'),
    successCriteriaJson: text('success_criteria_json').notNull().default('[]'),
    failureCriteriaJson: text('failure_criteria_json').notNull().default('[]'),
    blockedReason: text('blocked_reason'),
    discriminatingOutcomesJson: text('discriminating_outcomes_json').notNull(),
    triggeredBy: text('triggered_by').notNull(),
    status: text('status').notNull(),
    resultEvidenceIdsJson: text('result_evidence_ids_json').notNull(),
    round: integer('round').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('validation_tasks_run_id_fingerprint_unique').on(table.runId, table.fingerprint),
  ],
)

/** Canonical scientific-loop records; these are domain/audit records, not Agent memory. */
export const scientificHypotheses = sqliteTable('scientific_hypotheses', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  round: integer('round').notNull(),
  statement: text('statement').notNull(),
  mechanismCompositionJson: text('mechanism_composition_json').notNull(),
  predictionsJson: text('predictions_json').notNull(),
  falsificationConditionsJson: text('falsification_conditions_json').notNull(),
  sourceIdsJson: text('source_ids_json').notNull(),
  priority: text('priority'),
  priorityReason: text('priority_reason'),
  confidenceBasisJson: text('confidence_basis_json').notNull().default('[]'),
  scope: text('scope').notNull(),
  confidence: real('confidence').notNull(),
  parentId: text('parent_id'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
})

export const scientificEvidence = sqliteTable('scientific_evidence', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  round: integer('round').notNull(),
  hypothesisId: text('hypothesis_id'),
  taskId: text('task_id'),
  agentId: text('agent_id'),
  status: text('status').notNull(),
  evidenceRole: text('evidence_role').notNull().default('prediction_consistent'),
  contradictionScope: text('contradiction_scope').notNull().default('mechanism'),
  adjudicationJson: text('adjudication_json'),
  claim: text('claim').notNull(),
  observed: text('observed').notNull(),
  method: text('method').notNull(),
  sourceIdsJson: text('source_ids_json').notNull(),
  sampleIdsJson: text('sample_ids_json').notNull(),
  predictionIdsJson: text('prediction_ids_json').notNull().default('[]'),
  falsificationConditionIdsJson: text('falsification_condition_ids_json').notNull().default('[]'),
  provenanceJson: text('provenance_json'),
  lineageJson: text('lineage_json'),
  metricsJson: text('metrics_json'),
  quantitativeResultsJson: text('quantitative_results_json').notNull().default('[]'),
  uncertainty: text('uncertainty'),
  limitationsJson: text('limitations_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const scientificCorrections = sqliteTable('scientific_corrections', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  runId: text('run_id').notNull(),
  round: integer('round').notNull(),
  stage: text('stage').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  action: text('action').notNull(),
  evidenceAction: text('evidence_action').notNull().default('none'),
  affectedIdsJson: text('affected_ids_json').notNull(),
  triggeredByJson: text('triggered_by_json').notNull(),
  agentId: text('agent_id'),
  createdAt: text('created_at').notNull(),
})
