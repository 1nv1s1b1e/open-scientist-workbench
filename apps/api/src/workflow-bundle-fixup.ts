import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Nitro } from 'nitro/types'

/**
 * Nitro module that post-processes the @workflow/nitro-generated bundles
 * (`.nitro/workflow/steps.mjs` + `workflows.mjs`) to remove a runtime-breaking
 * dead-code import.
 *
 * ## Why this exists
 * `@workflow/builders`'s `fast-discovery.js` falsely flags its own
 * `serde-checker.js` as a "serde-only file" because that file contains a
 * string literal matching the `hasLikelySerdeClass` regex (the regex scans
 * source after stripping comments but NOT string literals). The string is an
 * error message: `static [WORKFLOW_SERIALIZE](...) { ... }`.
 *
 * Because `serde-checker.js` is wrongly added to `serdeOnlyFiles`, the virtual
 * entry does `import '@workflow/builders/dist/serde-checker.js'` → which
 * statically imports `builtin-modules` → which does
 * `import json with {type:'json'}`. esbuild's CJS output drops the import
 * attribute, and the `@workflow/core` VM sandbox's `defaultLoadSync` rejects
 * the attribute-less JSON import → `ERR_IMPORT_ATTRIBUTE_MISSING`.
 *
 * The imported values (`builtin_modules_default`, `nodeBuiltins`,
 * `nodeImportExtractRegex`) are **dead code** — never referenced anywhere in
 * the bundle. So removing the import has zero functional impact.
 *
 * ## How it works
 * Registers a `build:before` hook that runs AFTER `@workflow/nitro`'s
 * `build:before` (modules run in registration order; this module is listed
 * after `workflow/nitro` in `nitro.config.ts`). It reads the two bundle
 * files, replaces the problematic `import builtinModules from "...builtin-modules.json"`
 * line with a no-op `var builtinModules = []`, and writes them back.
 *
 * This is a build-time fix on generated artifacts (not a node_modules patch),
 * surviving `pnpm install` and working across environments.
 */
export default {
  name: 'workflow-bundle-fixup',
  setup(nitro: Nitro) {
    nitro.hooks.hook('build:before', async () => {
      const workflowDir = join(nitro.options.buildDir, 'workflow')
      for (const file of ['steps.mjs', 'workflows.mjs']) {
        const filePath = join(workflowDir, file)
        let content: string
        try {
          content = await readFile(filePath, 'utf-8')
        } catch {
          continue
        }
        // Match: import builtinModules from "...builtin-modules.json";
        // Replace with a dead-code-safe empty array assignment. The downstream
        // `var builtin_modules_default = builtinModules;` then binds to [],
        // and `nodeBuiltins = [].join("|")` → "" (empty regex alternation),
        // which is never used at runtime.
        const fixed = content.replace(
          /import\s+builtinModules\s+from\s+["'][^"']*builtin-modules\.json["'];?/g,
          'var builtinModules = [];',
        )
        if (fixed !== content) {
          await writeFile(filePath, fixed, 'utf-8')
          // eslint-disable-next-line no-console
          console.log(
            `[workflow-bundle-fixup] patched ${file} (removed dead builtin-modules JSON import)`,
          )
        }
      }
    })
  },
}
