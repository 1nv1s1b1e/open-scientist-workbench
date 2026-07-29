import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const runChunks = sqliteTable('run_chunks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  seq: integer('seq').notNull(),
  chunkJson: text('chunk_json').notNull(),
})
