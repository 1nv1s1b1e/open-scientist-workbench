// @ts-check
import { defineNitroConfig } from 'nitro/config'

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
  noExternals: ['@open-scientist/agents'],
  workflow: {
    dirs: ['.', '../../packages/agents/src'],
  },
})
