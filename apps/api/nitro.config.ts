// @ts-check
import { defineNitroConfig } from 'nitro/config'
// Load module augmentation for `workflow?: ModuleOptions` on NitroOptions.
// `workflow/nitro` re-exports `@workflow/nitro`, whose types.d.ts uses
// `declare module 'nitro/types'` to add the `workflow` field. Without this
// side-effect type import, tsc doesn't see the augmentation and errors on
// the `workflow` key below (TS2353).
import type {} from 'workflow/nitro'

export default defineNitroConfig({
  modules: ['workflow/nitro'],
  // Use serverEntry (not entry) so the Hono app acts as a catch-all web
  // handler for unmatched routes, while nitro's native router still
  // dispatches specific routes registered by modules (e.g. workflow's
  // /.well-known/workflow/v1/* handlers). `entry` would replace nitro's
  // runtime entry and break module-registered routes.
  serverEntry: './src/index.ts',
  // Override workspaceDir so the workflow builder's projectRoot resolves to
  // apps/api (whose package.json lists @open-scientist/agents as a dep). This
  // makes isWorkspacePackage() recognise agents as a workspace package and
  // generate workflowIds using the package name (e.g.
  // "workflow//@open-scientist/agents@0.0.0//tournamentWorkflow"), matching
  // the ids injected by the rollup SWC transform in the dev bundle. Without
  // this, the auto-detected monorepo root has no agents dep and the builder
  // falls back to relative-path ids, causing WorkflowNotRegisteredError.
  workspaceDir: import.meta.dirname,
  devServer: {
    port: Number(process.env.PORT ?? 3000),
  },
  // Bundle all workspace packages that agents transitively import — nitro/rolldown
  // must resolve them at build time. Any workspace dep left out here surfaces as
  // UNRESOLVED_IMPORT + "Dev worker failed after 3 retries", which silently stalls
  // 'use step' execution (the step function never runs because its module graph
  // fails to load).
  noExternals: [
    '@open-scientist/agents',
    '@open-scientist/logger',
    '@open-scientist/tools',
    '@open-scientist/skills',
    '@open-scientist/helix',
    '@open-scientist/config',
    '@open-scientist/schema',
    '@open-scientist/mcp',
  ],
  workflow: {
    dirs: ['.', '../../packages/agents/src'],
  },
})
