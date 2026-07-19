import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  type: text('type', { enum: ['api-key', 'oauth-token'] }).notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  baseURL: text('base_url'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const settings = sqliteTable('settings', {
  scope: text('scope').notNull(),
  name: text('name').notNull(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const mcpTrust = sqliteTable('mcp_trust', {
  id: text('id').primaryKey(),
  projectName: text('project_name').notNull(),
  serverName: text('server_name').notNull(),
  fingerprint: text('fingerprint').notNull(),
  trusted: integer('trusted', { mode: 'boolean' }).notNull(),
  firstSeen: text('first_seen').notNull(),
  lastChecked: text('last_checked').notNull(),
})

export const mcpToolBaselines = sqliteTable('mcp_tool_baselines', {
  id: text('id').primaryKey(),
  trustId: text('trust_id').notNull(),
  toolName: text('tool_name').notNull(),
  digest: text('digest').notNull(),
  recordedAt: text('recorded_at').notNull(),
})
