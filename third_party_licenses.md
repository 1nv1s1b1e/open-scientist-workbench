# Third-party dependency licenses

Generated from the installed dependency graph locked by `pnpm-lock.yaml` using `pnpm licenses list --json`. Package license texts remain in their installed distributions and upstream repositories. Regenerate this file after any lockfile change.

## Manual review required

`@yuku-codegen/binding-win32-x64@0.5.48` and `@yuku-parser/binding-win32-x64@0.5.48` report `Unknown` in pnpm metadata. Their upstream terms must be verified or the packages removed before submission.

The Qwen-compatible model endpoint is a remotely configured service, not redistributed by this repository. The team must list its service/model terms separately in the competition P4 table. JSOC/SDO data-use terms must likewise be verified separately; they are not software dependency licenses.

## Python runtime dependencies

| Package    | Locked version | Declared license                                                 |
| ---------- | -------------: | ---------------------------------------------------------------- |
| numpy      |          2.2.6 | BSD-3-Clause (wheel also carries notices for bundled components) |
| scipy      |         1.16.3 | BSD-3-Clause (wheel also carries notices for bundled components) |
| astropy    |          7.1.1 | BSD-3-Clause                                                     |
| matplotlib |         3.11.0 | Matplotlib License (PSF-compatible)                              |

## Node.js dependency graph

| Package                                 |        Locked version(s) | License                             | Homepage                                                                            |
| --------------------------------------- | -----------------------: | ----------------------------------- | ----------------------------------------------------------------------------------- |
| json-schema                             |                    0.4.0 | (AFL-2.1 OR BSD-3-Clause)           | https://github.com/kriszyp/json-schema#readme                                       |
| rc                                      |                    1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | https://github.com/dominictarr/rc#readme                                            |
| expand-template                         |                    2.0.3 | (MIT OR WTFPL)                      | https://github.com/ralphtheninja/expand-template                                    |
| tslib                                   |                    2.8.1 | 0BSD                                | https://www.typescriptlang.org/                                                     |
| @ai-sdk/anthropic                       |                   2.0.90 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| @ai-sdk/gateway                         |                   4.0.23 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| @ai-sdk/mcp                             |                   2.0.15 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| @ai-sdk/openai                          |                   4.0.16 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| @ai-sdk/provider                        |             2.0.3, 4.0.3 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| @ai-sdk/provider-utils                  |           3.0.30, 5.0.11 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| @drizzle-team/brocli                    |                   0.10.2 | Apache-2.0                          | https://github.com/drizzle-team/brocli                                              |
| @helix-db/helix-db                      |                    2.0.5 | Apache-2.0                          | https://github.com/HelixDB/helix-db/tree/main/sdks/typescript                       |
| @mongodb-js/zstd                        |                    7.0.0 | Apache-2.0                          | https://github.com/mongodb-js/zstd#readme                                           |
| @swc/helpers                            |                   0.5.15 | Apache-2.0                          | https://swc.rs                                                                      |
| @vercel/oidc                            |                    3.2.0 | Apache-2.0                          | https://vercel.com                                                                  |
| @workflow/serde                         |                    4.1.0 | Apache-2.0                          | https://github.com/vercel/workflow#readme                                           |
| ai                                      |                   7.0.31 | Apache-2.0                          | https://ai-sdk.dev/docs                                                             |
| aria-query                              |                    5.3.0 | Apache-2.0                          | https://github.com/A11yance/aria-query#readme                                       |
| baseline-browser-mapping                |                  2.10.43 | Apache-2.0                          | https://github.com/web-platform-dx/baseline-browser-mapping#readme                  |
| class-variance-authority                |                    0.7.1 | Apache-2.0                          | https://github.com/joe-bell/cva#readme                                              |
| detect-libc                             |             2.0.2, 2.1.2 | Apache-2.0                          | https://github.com/lovell/detect-libc#readme                                        |
| drizzle-orm                             |                   0.45.2 | Apache-2.0                          | https://orm.drizzle.team                                                            |
| expect-type                             |                    1.4.0 | Apache-2.0                          | https://github.com/mmkal/expect-type#readme                                         |
| just-bash                               |                    3.1.0 | Apache-2.0                          | https://github.com/vercel-labs/just-bash#readme                                     |
| sharp                                   |                   0.34.5 | Apache-2.0                          | https://sharp.pixelplumbing.com                                                     |
| tunnel-agent                            |                    0.6.0 | Apache-2.0                          | https://github.com/mikeal/tunnel-agent#readme                                       |
| typescript                              |                    6.0.3 | Apache-2.0                          | https://www.typescriptlang.org/                                                     |
| @img/sharp-win32-x64                    |                   0.34.5 | Apache-2.0 AND LGPL-3.0-or-later    | https://sharp.pixelplumbing.com                                                     |
| minimatch                               |                   10.2.5 | BlueOak-1.0.0                       | https://github.com/isaacs/minimatch#readme                                          |
| @mixmark-io/domino                      |                    2.2.0 | BSD-2-Clause                        | https://github.com/mixmark-io/domino#readme                                         |
| json-schema-typed                       |                    8.0.2 | BSD-2-Clause                        | https://github.com/RemyRylan/json-schema-typed/tree/main/dist/node                  |
| d3-ease                                 |                    3.0.1 | BSD-3-Clause                        | https://d3js.org/d3-ease/                                                           |
| diff                                    |                    8.0.4 | BSD-3-Clause                        | https://github.com/kpdecker/jsdiff#readme                                           |
| fast-uri                                |                    3.1.3 | BSD-3-Clause                        | https://github.com/fastify/fast-uri                                                 |
| ieee754                                 |                    1.2.1 | BSD-3-Clause                        | https://github.com/feross/ieee754#readme                                            |
| js-base64                               |                    3.9.1 | BSD-3-Clause                        | https://github.com/dankogai/js-base64#readme                                        |
| qs                                      |                   6.15.3 | BSD-3-Clause                        | https://github.com/ljharb/qs                                                        |
| secure-json-parse                       |                    4.1.0 | BSD-3-Clause                        | https://github.com/fastify/secure-json-parse#readme                                 |
| smol-toml                               |                    1.7.0 | BSD-3-Clause                        | https://github.com/squirrelchat/smol-toml#readme                                    |
| source-map                              |                    0.6.1 | BSD-3-Clause                        | https://github.com/mozilla/source-map                                               |
| source-map-js                           |                    1.2.1 | BSD-3-Clause                        | https://github.com/7rulnik/source-map-js                                            |
| sprintf-js                              |                    1.1.3 | BSD-3-Clause                        | https://github.com/alexei/sprintf.js#readme                                         |
| caniuse-lite                            |             1.0.30001806 | CC-BY-4.0                           | https://github.com/browserslist/caniuse-lite#readme                                 |
| chownr                                  |                    1.1.4 | ISC                                 | https://github.com/isaacs/chownr#readme                                             |
| d3-color                                |                    3.1.0 | ISC                                 | https://d3js.org/d3-color/                                                          |
| d3-dispatch                             |                    3.0.1 | ISC                                 | https://d3js.org/d3-dispatch/                                                       |
| d3-drag                                 |                    3.0.0 | ISC                                 | https://d3js.org/d3-drag/                                                           |
| d3-interpolate                          |                    3.0.1 | ISC                                 | https://d3js.org/d3-interpolate/                                                    |
| d3-selection                            |                    3.0.0 | ISC                                 | https://d3js.org/d3-selection/                                                      |
| d3-timer                                |                    3.0.1 | ISC                                 | https://d3js.org/d3-timer/                                                          |
| d3-transition                           |                    3.0.1 | ISC                                 | https://d3js.org/d3-transition/                                                     |
| d3-zoom                                 |                    3.0.0 | ISC                                 | https://d3js.org/d3-zoom/                                                           |
| graceful-fs                             |                   4.2.11 | ISC                                 | https://github.com/isaacs/node-graceful-fs#readme                                   |
| inherits                                |                    2.0.4 | ISC                                 | https://github.com/isaacs/inherits#readme                                           |
| ini                                     |             1.3.8, 6.0.0 | ISC                                 | https://github.com/npm/ini#readme                                                   |
| isexe                                   |                    2.0.0 | ISC                                 | https://github.com/isaacs/isexe#readme                                              |
| lucide-react                            |                   1.25.0 | ISC                                 | https://lucide.dev                                                                  |
| once                                    |                    1.4.0 | ISC                                 | https://github.com/isaacs/once#readme                                               |
| picocolors                              |                    1.1.1 | ISC                                 | https://github.com/alexeyraspopov/picocolors#readme                                 |
| promise-limit                           |                    2.7.0 | ISC                                 | https://github.com/featurist/promise-limit#readme                                   |
| semver                                  |                    7.8.5 | ISC                                 | https://github.com/npm/node-semver#readme                                           |
| setprototypeof                          |                    1.2.0 | ISC                                 | https://github.com/wesleytodd/setprototypeof                                        |
| siginfo                                 |                    2.0.0 | ISC                                 | https://github.com/emilbayes/siginfo#readme                                         |
| which                                   |                    2.0.2 | ISC                                 | https://github.com/isaacs/node-which#readme                                         |
| wrappy                                  |                    1.0.2 | ISC                                 | https://github.com/npm/wrappy                                                       |
| yaml                                    |                    2.9.0 | ISC                                 | https://eemeli.org/yaml/                                                            |
| zod-to-json-schema                      |                   3.25.2 | ISC                                 | https://github.com/StefanTerdell/zod-to-json-schema#readme                          |
| node-liblzma                            |                    2.2.0 | LGPL-3.0                            | https://github.com/oorabona/node-liblzma                                            |
| @alloc/quick-lru                        |                    5.2.0 | MIT                                 | https://github.com/sindresorhus/quick-lru#readme                                    |
| @assistant-ui/core                      |                   0.2.21 | MIT                                 | https://www.assistant-ui.com/                                                       |
| @assistant-ui/react                     |                  0.14.27 | MIT                                 | https://www.assistant-ui.com/                                                       |
| @assistant-ui/store                     |                   0.2.20 | MIT                                 | https://www.assistant-ui.com/                                                       |
| @assistant-ui/tap                       |                    0.9.4 | MIT                                 | https://www.assistant-ui.com/                                                       |
| @babel/code-frame                       |                   7.29.7 | MIT                                 | https://babel.dev/docs/en/next/babel-code-frame                                     |
| @babel/helper-validator-identifier      |                   7.29.7 | MIT                                 | https://github.com/babel/babel#readme                                               |
| @babel/runtime                          |                   7.29.7 | MIT                                 | https://babel.dev/docs/en/next/babel-runtime                                        |
| @blazediff/core                         |                    1.9.1 | MIT                                 | https://blazediff.dev                                                               |
| @borewit/text-codec                     |                    0.2.2 | MIT                                 | https://github.com/Borewit/text-codec#readme                                        |
| @cfworker/json-schema                   |                    4.1.1 | MIT                                 | https://github.com/cfworker/cfworker/tree/master/packages/json-schema/README.md     |
| @esbuild/win32-x64                      | 0.18.20, 0.25.12, 0.28.1 | MIT                                 | https://github.com/evanw/esbuild#readme                                             |
| @esbuild-kit/core-utils                 |                    3.3.2 | MIT                                 | https://github.com/esbuild-kit/core-utils#readme                                    |
| @esbuild-kit/esm-loader                 |                    2.6.5 | MIT                                 | https://github.com/esbuild-kit/esm-loader#readme                                    |
| @floating-ui/core                       |                    1.8.0 | MIT                                 | https://floating-ui.com                                                             |
| @floating-ui/dom                        |                    1.8.0 | MIT                                 | https://floating-ui.com                                                             |
| @floating-ui/react-dom                  |                    2.1.9 | MIT                                 | https://floating-ui.com/docs/react-dom                                              |
| @floating-ui/utils                      |                   0.2.12 | MIT                                 | https://floating-ui.com                                                             |
| @hono/node-server                       |          1.19.14, 2.0.10 | MIT                                 | https://github.com/honojs/node-server                                               |
| @img/colour                             |                    1.1.0 | MIT                                 | https://github.com/lovell/colour#readme                                             |
| @jitl/quickjs-ffi-types                 |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| @jitl/quickjs-wasmfile-debug-asyncify   |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| @jitl/quickjs-wasmfile-debug-sync       |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| @jitl/quickjs-wasmfile-release-asyncify |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| @jitl/quickjs-wasmfile-release-sync     |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| @jridgewell/gen-mapping                 |                   0.3.13 | MIT                                 | https://github.com/jridgewell/sourcemaps/tree/main/packages/gen-mapping             |
| @jridgewell/remapping                   |                    2.3.5 | MIT                                 | https://github.com/jridgewell/sourcemaps/tree/main/packages/remapping               |
| @jridgewell/resolve-uri                 |                    3.1.2 | MIT                                 | https://github.com/jridgewell/resolve-uri#readme                                    |
| @jridgewell/sourcemap-codec             |                    1.5.5 | MIT                                 | https://github.com/jridgewell/sourcemaps/tree/main/packages/sourcemap-codec         |
| @jridgewell/trace-mapping               |                   0.3.31 | MIT                                 | https://github.com/jridgewell/sourcemaps/tree/main/packages/trace-mapping           |
| @langchain/core                         |                    1.2.5 | MIT                                 | https://github.com/langchain-ai/langchainjs/tree/main/langchain-core/               |
| @langchain/langgraph                    |                    1.4.9 | MIT                                 | https://github.com/langchain-ai/langgraphjs#readme                                  |
| @langchain/langgraph-checkpoint         |                    1.1.3 | MIT                                 | https://github.com/langchain-ai/langgraphjs#readme                                  |
| @langchain/langgraph-checkpoint-sqlite  |                    1.0.3 | MIT                                 | https://github.com/langchain-ai/langgraphjs#readme                                  |
| @langchain/langgraph-sdk                |                   1.9.28 | MIT                                 | https://github.com/langchain-ai/langgraphjs#readme                                  |
| @langchain/protocol                     |                   0.0.18 | MIT                                 |                                                                                     |
| @libsql/client                          |                   0.17.4 | MIT                                 | https://github.com/tursodatabase/libsql-client-ts#readme                            |
| @libsql/core                            |                   0.17.4 | MIT                                 | https://github.com/tursodatabase/libsql-client-ts#readme                            |
| @libsql/hrana-client                    |                   0.10.0 | MIT                                 | https://github.com/libsql/hrana-client-ts                                           |
| @libsql/isomorphic-ws                   |                    0.1.5 | MIT                                 | https://github.com/libsql/isomorphic-ts/tree/main/isomorphic-ws                     |
| @libsql/win32-x64-msvc                  |                   0.5.29 | MIT                                 | https://github.com/tursodatabase/libsql-js                                          |
| @modelcontextprotocol/sdk               |                   1.29.0 | MIT                                 | https://modelcontextprotocol.io                                                     |
| @neon-rs/load                           |                    0.0.4 | MIT                                 | https://github.com/dherman/neon-rs#readme                                           |
| @next/env                               |                  16.2.10 | MIT                                 | https://github.com/vercel/next.js#readme                                            |
| @next/swc-win32-x64-msvc                |                  16.2.10 | MIT                                 | https://github.com/vercel/next.js#readme                                            |
| @nodable/entities                       |                    3.0.0 | MIT                                 | https://github.com/nodable/val-parsers#readme                                       |
| @oxc-project/runtime                    |                  0.139.0 | MIT                                 | https://oxc.rs                                                                      |
| @oxc-project/types                      |                  0.139.0 | MIT                                 | https://oxc.rs                                                                      |
| @oxfmt/binding-win32-x64-msvc           |                   0.58.0 | MIT                                 | https://oxc.rs/docs/guide/usage/formatter                                           |
| @oxlint/binding-win32-x64-msvc          |                   1.73.0 | MIT                                 | https://oxc.rs/docs/guide/usage/linter                                              |
| @oxlint/plugins                         |                   1.73.0 | MIT                                 | https://oxc.rs/docs/guide/usage/linter/js-plugins                                   |
| @oxlint-tsgolint/win32-x64              |                   0.24.0 | MIT                                 | https://github.com/oxc-project/tsgolint#readme                                      |
| @polka/url                              |            1.0.0-next.29 | MIT                                 | https://github.com/lukeed/polka#readme                                              |
| @radix-ui/number                        |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/primitive                     |             1.1.5, 1.1.6 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-accessible-icon         |                   1.1.11 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-accordion               |                   1.2.16 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-alert-dialog            |                   1.1.19 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-arrow                   |           1.1.11, 1.1.12 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-aspect-ratio            |                   1.1.11 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-avatar                  |                    1.2.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-checkbox                |                    1.3.7 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-collapsible             |                   1.1.16 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-collection              |                   1.1.12 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-compose-refs            |                    1.1.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-context                 |                    1.2.0 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-context-menu            |                    2.3.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-dialog                  |           1.1.19, 1.1.20 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-direction               |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-dismissable-layer       |           1.1.15, 1.1.16 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-dropdown-menu           |                   2.1.20 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-focus-guards            |                    1.1.4 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-focus-scope             |           1.1.12, 1.1.13 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-form                    |                   0.1.12 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-hover-card              |                   1.1.19 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-id                      |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-label                   |                   2.1.11 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-menu                    |                   2.1.20 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-menubar                 |                   1.1.20 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-navigation-menu         |                   1.2.18 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-one-time-password-field |                   0.1.12 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-password-toggle-field   |                    0.1.7 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-popover                 |           1.1.19, 1.1.20 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-popper                  |             1.3.3, 1.3.4 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-portal                  |           1.1.13, 1.1.14 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-presence                |             1.1.7, 1.1.8 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-primitive               |                    2.1.7 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-progress                |                   1.1.12 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-radio-group             |                    1.4.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-roving-focus            |           1.1.15, 1.1.16 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-scroll-area             |           1.2.14, 1.2.15 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-select                  |             2.3.3, 2.3.4 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-separator               |                   1.1.11 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-slider                  |                    1.4.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-slot                    |                    1.3.0 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-switch                  |                    1.3.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-tabs                    |           1.1.17, 1.1.18 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-toast                   |                   1.2.19 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-toggle                  |                   1.1.14 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-toggle-group            |                   1.1.15 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-toolbar                 |                   1.1.15 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-tooltip                 |           1.2.12, 1.2.13 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-callback-ref        |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-controllable-state  |             1.2.3, 1.2.4 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-effect-event        |                    0.0.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-escape-keydown      |                    1.1.3 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-is-hydrated         |                    0.1.1 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-layout-effect       |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-previous            |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-rect                |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-use-size                |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/react-visually-hidden         |             1.2.7, 1.2.8 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @radix-ui/rect                          |                    1.1.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| @standard-schema/spec                   |                    1.1.0 | MIT                                 | https://standardschema.dev                                                          |
| @tailwindcss/node                       |                    4.3.3 | MIT                                 | https://tailwindcss.com                                                             |
| @tailwindcss/oxide                      |                    4.3.3 | MIT                                 | https://github.com/tailwindlabs/tailwindcss#readme                                  |
| @tailwindcss/oxide-win32-x64-msvc       |                    4.3.3 | MIT                                 | https://github.com/tailwindlabs/tailwindcss#readme                                  |
| @tailwindcss/postcss                    |                    4.3.3 | MIT                                 | https://tailwindcss.com                                                             |
| @tanstack/query-core                    |                  5.101.2 | MIT                                 | https://tanstack.com/query                                                          |
| @tanstack/react-query                   |                  5.101.2 | MIT                                 | https://tanstack.com/query                                                          |
| @testing-library/dom                    |                   10.4.1 | MIT                                 | https://github.com/testing-library/dom-testing-library#readme                       |
| @testing-library/user-event             |                   14.6.1 | MIT                                 | https://github.com/testing-library/user-event#readme                                |
| @tokenizer/inflate                      |                    0.4.1 | MIT                                 | https://github.com/Borewit/tokenizer-inflate#readme                                 |
| @tokenizer/token                        |                    0.3.0 | MIT                                 | https://github.com/Borewit/tokenizer-token#readme                                   |
| @types/aria-query                       |                    5.0.4 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/aria-query     |
| @types/better-sqlite3                   |                   7.6.13 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/better-sqlite3 |
| @types/chai                             |                    5.2.3 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/chai           |
| @types/d3-color                         |                    3.1.3 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-color       |
| @types/d3-drag                          |                    3.0.7 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-drag        |
| @types/d3-interpolate                   |                    3.0.4 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-interpolate |
| @types/d3-selection                     |                   3.0.11 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-selection   |
| @types/d3-transition                    |                    3.0.9 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-transition  |
| @types/d3-zoom                          |                    3.0.8 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-zoom        |
| @types/deep-eql                         |                    4.0.2 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/deep-eql       |
| @types/estree                           |                    1.0.9 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/estree         |
| @types/json-schema                      |                   7.0.15 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/json-schema    |
| @types/node                             |                   26.1.1 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node           |
| @types/react                            |                  19.2.17 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react          |
| @types/react-dom                        |                   19.2.3 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom      |
| @types/ws                               |                   8.18.1 | MIT                                 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/ws             |
| @vitest/browser                         |                   4.1.10 | MIT                                 | https://vitest.dev/guide/browser/                                                   |
| @vitest/browser-preview                 |                   4.1.10 | MIT                                 | https://vitest.dev/guide/browser                                                    |
| @vitest/expect                          |                   4.1.10 | MIT                                 | https://vitest.dev/api/expect                                                       |
| @vitest/mocker                          |                   4.1.10 | MIT                                 | https://github.com/vitest-dev/vitest/tree/main/packages/mocker                      |
| @vitest/pretty-format                   |                   4.1.10 | MIT                                 | https://github.com/vitest-dev/vitest/tree/main/packages/pretty-format               |
| @vitest/runner                          |                   4.1.10 | MIT                                 | https://vitest.dev/api/advanced/runner                                              |
| @vitest/snapshot                        |                   4.1.10 | MIT                                 | https://vitest.dev/guide/snapshot                                                   |
| @vitest/spy                             |                   4.1.10 | MIT                                 | https://vitest.dev/api/mock                                                         |
| @vitest/utils                           |                   4.1.10 | MIT                                 | https://github.com/vitest-dev/vitest/tree/main/packages/utils                       |
| @voidzero-dev/vite-plus-core            |                    0.2.5 | MIT                                 | https://viteplus.dev/guide                                                          |
| @voidzero-dev/vite-plus-win32-x64-msvc  |                    0.2.5 | MIT                                 | https://viteplus.dev/guide                                                          |
| @xyflow/react                           |                  12.11.2 | MIT                                 | https://reactflow.dev                                                               |
| @xyflow/system                          |                   0.0.79 | MIT                                 | https://github.com/xyflow/xyflow#readme                                             |
| @yuku-toolchain/types                   |                   0.5.43 | MIT                                 | https://github.com/yuku-toolchain/yuku#readme                                       |
| accepts                                 |                    2.0.0 | MIT                                 | https://github.com/jshttp/accepts#readme                                            |
| ajv                                     |                   8.20.0 | MIT                                 | https://ajv.js.org                                                                  |
| ajv-formats                             |                    3.0.1 | MIT                                 | https://github.com/ajv-validator/ajv-formats#readme                                 |
| ansi-regex                              |                    5.0.1 | MIT                                 | https://github.com/chalk/ansi-regex#readme                                          |
| ansi-styles                             |                    5.2.0 | MIT                                 | https://github.com/chalk/ansi-styles#readme                                         |
| anynum                                  |                    1.0.1 | MIT                                 | https://github.com/NaturalIntelligence/anynum#readme                                |
| aria-hidden                             |                    1.2.6 | MIT                                 | https://github.com/theKashey/aria-hidden#readme                                     |
| assertion-error                         |                    2.0.1 | MIT                                 | https://github.com/chaijs/assertion-error#readme                                    |
| assistant-cloud                         |                   0.1.35 | MIT                                 | https://www.assistant-ui.com/                                                       |
| assistant-stream                        |                   0.3.26 | MIT                                 | https://www.assistant-ui.com/                                                       |
| balanced-match                          |                    4.0.4 | MIT                                 | https://github.com/juliangruber/balanced-match#readme                               |
| base64-js                               |                    1.5.1 | MIT                                 | https://github.com/beatgammit/base64-js                                             |
| better-sqlite3                          |                  12.11.1 | MIT                                 | http://github.com/WiseLibs/better-sqlite3                                           |
| bindings                                |                    1.5.0 | MIT                                 | https://github.com/TooTallNate/node-bindings                                        |
| bl                                      |                    4.1.0 | MIT                                 | https://github.com/rvagg/bl                                                         |
| body-parser                             |                    2.3.0 | MIT                                 | https://github.com/expressjs/body-parser#readme                                     |
| brace-expansion                         |                    5.0.7 | MIT                                 | https://github.com/juliangruber/brace-expansion#readme                              |
| buffer                                  |                    5.7.1 | MIT                                 | https://github.com/feross/buffer                                                    |
| buffer-from                             |                    1.1.2 | MIT                                 | https://github.com/LinusU/buffer-from#readme                                        |
| bytes                                   |                    3.1.2 | MIT                                 | https://github.com/visionmedia/bytes.js#readme                                      |
| call-bind-apply-helpers                 |                    1.0.2 | MIT                                 | https://github.com/ljharb/call-bind-apply-helpers#readme                            |
| call-bound                              |                    1.0.4 | MIT                                 | https://github.com/ljharb/call-bound#readme                                         |
| chai                                    |                    6.2.2 | MIT                                 | http://chaijs.com                                                                   |
| classcat                                |                    5.0.5 | MIT                                 | https://github.com/jorgebucaran/classcat#readme                                     |
| client-only                             |                    0.0.1 | MIT                                 | https://reactjs.org/                                                                |
| clsx                                    |                    2.1.1 | MIT                                 | https://github.com/lukeed/clsx#readme                                               |
| commander                               |                    6.2.1 | MIT                                 | https://github.com/tj/commander.js#readme                                           |
| consola                                 |                    3.4.2 | MIT                                 | https://github.com/unjs/consola#readme                                              |
| content-disposition                     |                    1.1.0 | MIT                                 | https://github.com/jshttp/content-disposition#readme                                |
| content-type                            |             1.0.5, 2.0.0 | MIT                                 | https://github.com/jshttp/content-type#readme                                       |
| convert-source-map                      |                    2.0.0 | MIT                                 | https://github.com/thlorenz/convert-source-map                                      |
| cookie                                  |                    0.7.2 | MIT                                 | https://github.com/jshttp/cookie#readme                                             |
| cookie-signature                        |                    1.2.2 | MIT                                 | https://github.com/visionmedia/node-cookie-signature#readme                         |
| cors                                    |                    2.8.6 | MIT                                 | https://github.com/expressjs/cors#readme                                            |
| cross-spawn                             |                    7.0.6 | MIT                                 | https://github.com/moxystudio/node-cross-spawn                                      |
| csstype                                 |                    3.2.3 | MIT                                 | https://github.com/frenic/csstype#readme                                            |
| debug                                   |                    4.4.3 | MIT                                 | https://github.com/debug-js/debug#readme                                            |
| decompress-response                     |                    6.0.0 | MIT                                 | https://github.com/sindresorhus/decompress-response#readme                          |
| deep-extend                             |                    0.6.0 | MIT                                 | https://github.com/unclechu/node-deep-extend                                        |
| depd                                    |                    2.0.0 | MIT                                 | https://github.com/dougwilson/nodejs-depd#readme                                    |
| dequal                                  |                    2.0.3 | MIT                                 | https://github.com/lukeed/dequal#readme                                             |
| detect-node-es                          |                    1.1.0 | MIT                                 | https://github.com/thekashey/detect-node                                            |
| dom-accessibility-api                   |                   0.5.16 | MIT                                 | https://github.com/eps1lon/dom-accessibility-api#readme                             |
| drizzle-kit                             |                  0.31.10 | MIT                                 | https://orm.drizzle.team                                                            |
| dunder-proto                            |                    1.0.1 | MIT                                 | https://github.com/es-shims/dunder-proto#readme                                     |
| ee-first                                |                    1.1.1 | MIT                                 | https://github.com/jonathanong/ee-first#readme                                      |
| encodeurl                               |                    2.0.0 | MIT                                 | https://github.com/pillarjs/encodeurl#readme                                        |
| end-of-stream                           |                    1.4.5 | MIT                                 | https://github.com/mafintosh/end-of-stream                                          |
| enhanced-resolve                        |                   5.24.2 | MIT                                 | https://github.com/webpack/enhanced-resolve#readme                                  |
| esbuild                                 | 0.18.20, 0.25.12, 0.28.1 | MIT                                 | https://github.com/evanw/esbuild#readme                                             |
| escape-html                             |                    1.0.3 | MIT                                 | https://github.com/component/escape-html#readme                                     |
| es-define-property                      |                    1.0.1 | MIT                                 | https://github.com/ljharb/es-define-property#readme                                 |
| es-errors                               |                    1.3.0 | MIT                                 | https://github.com/ljharb/es-errors#readme                                          |
| es-module-lexer                         |                    2.3.1 | MIT                                 | https://github.com/guybedford/es-module-lexer#readme                                |
| es-object-atoms                         |                    1.1.2 | MIT                                 | https://github.com/ljharb/es-object-atoms#readme                                    |
| estree-walker                           |                    3.0.3 | MIT                                 | https://github.com/Rich-Harris/estree-walker#readme                                 |
| etag                                    |                    1.8.1 | MIT                                 | https://github.com/jshttp/etag#readme                                               |
| eventemitter3                           |             4.0.7, 5.0.4 | MIT                                 | https://github.com/primus/eventemitter3#readme                                      |
| eventsource                             |                    3.0.7 | MIT                                 | https://github.com/EventSource/eventsource#readme                                   |
| eventsource-parser                      |                    3.1.0 | MIT                                 | https://github.com/rexxars/eventsource-parser#readme                                |
| express                                 |                    5.2.1 | MIT                                 | https://expressjs.com/                                                              |
| express-rate-limit                      |                    8.6.0 | MIT                                 | https://github.com/express-rate-limit/express-rate-limit                            |
| fast-deep-equal                         |                    3.1.3 | MIT                                 | https://github.com/epoberezkin/fast-deep-equal#readme                               |
| fast-xml-builder                        |                    1.3.0 | MIT                                 | https://github.com/NaturalIntelligence/fast-xml-builder#readme                      |
| fast-xml-parser                         |                   5.10.1 | MIT                                 | https://github.com/NaturalIntelligence/fast-xml-parser#readme                       |
| fdir                                    |                    6.5.0 | MIT                                 | https://github.com/thecodrr/fdir#readme                                             |
| file-type                               |                   21.3.4 | MIT                                 | https://github.com/sindresorhus/file-type#readme                                    |
| file-uri-to-path                        |                    1.0.0 | MIT                                 | https://github.com/TooTallNate/file-uri-to-path                                     |
| finalhandler                            |                    2.1.1 | MIT                                 | https://github.com/pillarjs/finalhandler#readme                                     |
| forwarded                               |                    0.2.0 | MIT                                 | https://github.com/jshttp/forwarded#readme                                          |
| framer-motion                           |                  12.42.2 | MIT                                 | https://github.com/motiondivision/motion#readme                                     |
| fresh                                   |                    2.0.0 | MIT                                 | https://github.com/jshttp/fresh#readme                                              |
| fs-constants                            |                    1.0.0 | MIT                                 | https://github.com/mafintosh/fs-constants                                           |
| function-bind                           |                    1.1.2 | MIT                                 | https://github.com/Raynos/function-bind                                             |
| get-intrinsic                           |                    1.3.0 | MIT                                 | https://github.com/ljharb/get-intrinsic#readme                                      |
| get-nonce                               |                    1.0.1 | MIT                                 | https://github.com/theKashey/get-nonce                                              |
| get-proto                               |                    1.0.1 | MIT                                 | https://github.com/ljharb/get-proto#readme                                          |
| get-tsconfig                            |                   4.14.0 | MIT                                 | https://github.com/privatenumber/get-tsconfig#readme                                |
| github-from-package                     |                    0.0.0 | MIT                                 | https://github.com/substack/github-from-package                                     |
| gopd                                    |                    1.2.0 | MIT                                 | https://github.com/ljharb/gopd#readme                                               |
| hasown                                  |                    2.0.4 | MIT                                 | https://github.com/inspect-js/hasOwn#readme                                         |
| has-symbols                             |                    1.1.0 | MIT                                 | https://github.com/ljharb/has-symbols#readme                                        |
| hono                                    |         4.12.30, 4.12.31 | MIT                                 | https://hono.dev                                                                    |
| http-errors                             |                    2.0.1 | MIT                                 | https://github.com/jshttp/http-errors#readme                                        |
| iconv-lite                              |                    0.7.3 | MIT                                 | https://github.com/pillarjs/iconv-lite                                              |
| ipaddr.js                               |                    1.9.1 | MIT                                 | https://github.com/whitequark/ipaddr.js#readme                                      |
| ip-address                              |                   10.2.0 | MIT                                 | https://github.com/beaugunderson/ip-address#readme                                  |
| is-network-error                        |                    1.3.2 | MIT                                 | https://github.com/sindresorhus/is-network-error#readme                             |
| is-promise                              |                    4.0.0 | MIT                                 | https://github.com/then/is-promise#readme                                           |
| is-unsafe                               |                    2.0.0 | MIT                                 | https://github.com/NaturalIntelligence/is-unsafe#readme                             |
| jiti                                    |                    2.7.0 | MIT                                 | https://github.com/unjs/jiti#readme                                                 |
| jose                                    |                    6.2.3 | MIT                                 | https://github.com/panva/jose                                                       |
| json-schema-traverse                    |                    1.0.0 | MIT                                 | https://github.com/epoberezkin/json-schema-traverse#readme                          |
| js-tiktoken                             |                   1.0.21 | MIT                                 | https://github.com/dqbd/tiktoken#readme                                             |
| js-tokens                               |                    4.0.0 | MIT                                 | https://github.com/lydell/js-tokens#readme                                          |
| langsmith                               |                    0.8.9 | MIT                                 | https://github.com/langchain-ai/langsmith-sdk#readme                                |
| libsql                                  |                   0.5.29 | MIT                                 | https://github.com/tursodatabase/libsql-js                                          |
| lz-string                               |                    1.5.0 | MIT                                 | http://pieroxy.net/blog/pages/lz-string/index.html                                  |
| magic-string                            |                  0.30.21 | MIT                                 | https://github.com/Rich-Harris/magic-string#readme                                  |
| math-intrinsics                         |                    1.1.0 | MIT                                 | https://github.com/es-shims/math-intrinsics#readme                                  |
| media-typer                             |                    1.1.0 | MIT                                 | https://github.com/jshttp/media-typer#readme                                        |
| merge-descriptors                       |                    2.0.0 | MIT                                 | https://github.com/sindresorhus/merge-descriptors#readme                            |
| mime-db                                 |                   1.54.0 | MIT                                 | https://github.com/jshttp/mime-db#readme                                            |
| mime-types                              |                    3.0.2 | MIT                                 | https://github.com/jshttp/mime-types#readme                                         |
| mimic-response                          |                    3.1.0 | MIT                                 | https://github.com/sindresorhus/mimic-response#readme                               |
| minimist                                |                    1.2.8 | MIT                                 | https://github.com/minimistjs/minimist                                              |
| mkdirp-classic                          |                    0.5.3 | MIT                                 | https://github.com/mafintosh/mkdirp-classic                                         |
| modern-tar                              |                    0.7.6 | MIT                                 | https://github.com/ayuhito/modern-tar                                               |
| motion                                  |                  12.42.2 | MIT                                 | https://github.com/motiondivision/motion#readme                                     |
| motion-dom                              |                  12.42.2 | MIT                                 | https://github.com/motiondivision/motion#readme                                     |
| motion-utils                            |                  12.39.0 | MIT                                 | https://github.com/motiondivision/motion#readme                                     |
| mrmime                                  |                    2.0.1 | MIT                                 | https://github.com/lukeed/mrmime#readme                                             |
| ms                                      |                    2.1.3 | MIT                                 | https://github.com/vercel/ms#readme                                                 |
| mustache                                |                    4.2.0 | MIT                                 | https://github.com/janl/mustache.js                                                 |
| nanoid                                  |            3.3.16, 6.0.0 | MIT                                 | https://github.com/ai/nanoid#readme                                                 |
| napi-build-utils                        |                    2.0.0 | MIT                                 | https://github.com/inspiredware/napi-build-utils#readme                             |
| negotiator                              |                    1.0.0 | MIT                                 | https://github.com/jshttp/negotiator#readme                                         |
| next                                    |                  16.2.10 | MIT                                 | https://nextjs.org                                                                  |
| node-abi                                |                   3.94.0 | MIT                                 | https://github.com/electron/node-abi#readme                                         |
| node-addon-api                          |                    8.9.0 | MIT                                 | https://github.com/nodejs/node-addon-api                                            |
| node-gyp-build                          |                    4.8.4 | MIT                                 | https://github.com/prebuild/node-gyp-build                                          |
| object-assign                           |                    4.1.1 | MIT                                 | https://github.com/sindresorhus/object-assign#readme                                |
| object-inspect                          |                   1.13.4 | MIT                                 | https://github.com/inspect-js/object-inspect                                        |
| obug                                    |                    2.1.4 | MIT                                 | https://github.com/sxzz/obug#readme                                                 |
| on-finished                             |                    2.4.1 | MIT                                 | https://github.com/jshttp/on-finished#readme                                        |
| oxfmt                                   |                   0.58.0 | MIT                                 | https://oxc.rs/docs/guide/usage/formatter                                           |
| oxlint                                  |                   1.73.0 | MIT                                 | https://oxc.rs/docs/guide/usage/linter                                              |
| oxlint-tsgolint                         |                   0.24.0 | MIT                                 | https://github.com/oxc-project/tsgolint#readme                                      |
| papaparse                               |                    5.5.4 | MIT                                 | https://www.papaparse.com/                                                          |
| parseurl                                |                    1.3.3 | MIT                                 | https://github.com/pillarjs/parseurl#readme                                         |
| pathe                                   |                    2.0.3 | MIT                                 | https://github.com/unjs/pathe#readme                                                |
| path-expression-matcher                 |                    1.6.2 | MIT                                 | https://github.com/NaturalIntelligence/path-expression-matcher#readme               |
| path-key                                |                    3.1.1 | MIT                                 | https://github.com/sindresorhus/path-key#readme                                     |
| path-to-regexp                          |                    8.4.2 | MIT                                 | https://github.com/pillarjs/path-to-regexp#readme                                   |
| p-finally                               |                    1.0.0 | MIT                                 | https://github.com/sindresorhus/p-finally#readme                                    |
| picomatch                               |                    4.0.5 | MIT                                 | https://github.com/micromatch/picomatch                                             |
| pkce-challenge                          |                    5.0.1 | MIT                                 | https://github.com/crouchcd/pkce-challenge#readme                                   |
| pngjs                                   |                    7.0.0 | MIT                                 | https://github.com/lukeapage/pngjs                                                  |
| postcss                                 |           8.4.31, 8.5.19 | MIT                                 | https://postcss.org/                                                                |
| p-queue                                 |             6.6.2, 9.3.3 | MIT                                 | https://github.com/sindresorhus/p-queue#readme                                      |
| prebuild-install                        |                    7.1.3 | MIT                                 | https://github.com/prebuild/prebuild-install                                        |
| p-retry                                 |                    7.1.1 | MIT                                 | https://github.com/sindresorhus/p-retry#readme                                      |
| pretty-format                           |                   27.5.1 | MIT                                 | https://github.com/facebook/jest#readme                                             |
| proxy-addr                              |                    2.0.7 | MIT                                 | https://github.com/jshttp/proxy-addr#readme                                         |
| p-timeout                               |             3.2.0, 7.0.1 | MIT                                 | https://github.com/sindresorhus/p-timeout#readme                                    |
| pump                                    |                    3.0.4 | MIT                                 | https://github.com/mafintosh/pump#readme                                            |
| quickjs-emscripten                      |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| quickjs-emscripten-core                 |                   0.32.0 | MIT                                 | https://github.com/justjake/quickjs-emscripten#readme                               |
| radix-ui                                |                    1.6.2 | MIT                                 | https://radix-ui.com/primitives                                                     |
| range-parser                            |                    1.3.0 | MIT                                 | https://github.com/jshttp/range-parser#readme                                       |
| raw-body                                |                    3.0.2 | MIT                                 | https://github.com/stream-utils/raw-body#readme                                     |
| re2js                                   |                    1.3.3 | MIT                                 | https://github.com/le0pard/re2js#readme                                             |
| react                                   |                   19.2.7 | MIT                                 | https://react.dev/                                                                  |
| react-dom                               |                   19.2.7 | MIT                                 | https://react.dev/                                                                  |
| react-is                                |                   17.0.2 | MIT                                 | https://reactjs.org/                                                                |
| react-remove-scroll                     |                    2.7.2 | MIT                                 | https://github.com/theKashey/react-remove-scroll#readme                             |
| react-remove-scroll-bar                 |                    2.3.8 | MIT                                 | https://github.com/theKashey/react-remove-scroll-bar#readme                         |
| react-style-singleton                   |                    2.2.3 | MIT                                 | https://github.com/theKashey/react-style-singleton#readme                           |
| react-textarea-autosize                 |                    8.5.9 | MIT                                 | https://github.com/Andarist/react-textarea-autosize#readme                          |
| readable-stream                         |                    3.6.2 | MIT                                 | https://github.com/nodejs/readable-stream#readme                                    |
| require-from-string                     |                    2.0.2 | MIT                                 | https://github.com/floatdrop/require-from-string#readme                             |
| resolve-pkg-maps                        |                    1.0.0 | MIT                                 | https://github.com/privatenumber/resolve-pkg-maps#readme                            |
| router                                  |                    2.2.0 | MIT                                 | https://github.com/pillarjs/router#readme                                           |
| safe-buffer                             |                    5.2.1 | MIT                                 | https://github.com/feross/safe-buffer                                               |
| safe-content-frame                      |                   0.0.23 | MIT                                 | https://www.assistant-ui.com/safe-content-frame                                     |
| safer-buffer                            |                    2.1.2 | MIT                                 | https://github.com/ChALkeR/safer-buffer#readme                                      |
| scheduler                               |                   0.27.0 | MIT                                 | https://react.dev/                                                                  |
| seek-bzip                               |                    2.0.0 | MIT                                 | https://github.com/cscott/seek-bzip#readme                                          |
| send                                    |                    1.2.1 | MIT                                 | https://github.com/pillarjs/send#readme                                             |
| serve-static                            |                    2.2.1 | MIT                                 | https://github.com/expressjs/serve-static#readme                                    |
| shebang-command                         |                    2.0.0 | MIT                                 | https://github.com/kevva/shebang-command#readme                                     |
| shebang-regex                           |                    3.0.0 | MIT                                 | https://github.com/sindresorhus/shebang-regex#readme                                |
| side-channel                            |                    1.1.1 | MIT                                 | https://github.com/ljharb/side-channel#readme                                       |
| side-channel-list                       |                    1.0.1 | MIT                                 | https://github.com/ljharb/side-channel-list#readme                                  |
| side-channel-map                        |                    1.0.1 | MIT                                 | https://github.com/ljharb/side-channel-map#readme                                   |
| side-channel-weakmap                    |                    1.0.2 | MIT                                 | https://github.com/ljharb/side-channel-weakmap#readme                               |
| simple-concat                           |                    1.0.1 | MIT                                 | https://github.com/feross/simple-concat                                             |
| simple-get                              |                    4.0.1 | MIT                                 | https://github.com/feross/simple-get                                                |
| sirv                                    |                    3.0.2 | MIT                                 | https://github.com/lukeed/sirv#readme                                               |
| source-map-support                      |                   0.5.21 | MIT                                 | https://github.com/evanw/node-source-map-support#readme                             |
| sql.js                                  |                   1.14.1 | MIT                                 | http://github.com/sql-js/sql.js                                                     |
| stackback                               |                    0.0.2 | MIT                                 | https://github.com/shtylman/node-stackback#readme                                   |
| statuses                                |                    2.0.2 | MIT                                 | https://github.com/jshttp/statuses#readme                                           |
| std-env                                 |                    4.2.0 | MIT                                 | https://github.com/unjs/std-env#readme                                              |
| string_decoder                          |                    1.3.0 | MIT                                 | https://github.com/nodejs/string_decoder                                            |
| strip-json-comments                     |                    2.0.1 | MIT                                 | https://github.com/sindresorhus/strip-json-comments#readme                          |
| strnum                                  |                    2.4.1 | MIT                                 | https://github.com/NaturalIntelligence/strnum#readme                                |
| strtok3                                 |                   10.3.5 | MIT                                 | https://github.com/Borewit/strtok3#readme                                           |
| styled-jsx                              |                    5.1.6 | MIT                                 | https://github.com/vercel/styled-jsx#readme                                         |
| supports-color                          |                   10.2.2 | MIT                                 | https://github.com/chalk/supports-color#readme                                      |
| tailwindcss                             |                    4.3.3 | MIT                                 | https://tailwindcss.com                                                             |
| tailwind-merge                          |                    3.6.0 | MIT                                 | https://github.com/dcastil/tailwind-merge                                           |
| tapable                                 |                    2.3.3 | MIT                                 | https://github.com/webpack/tapable                                                  |
| tar-fs                                  |                    2.1.5 | MIT                                 | https://github.com/mafintosh/tar-fs                                                 |
| tar-stream                              |                    2.2.0 | MIT                                 | https://github.com/mafintosh/tar-stream                                             |
| tinybench                               |                    2.9.0 | MIT                                 | https://github.com/tinylibs/tinybench#readme                                        |
| tinyexec                                |                    1.2.4 | MIT                                 | https://github.com/tinylibs/tinyexec#readme                                         |
| tinyglobby                              |                   0.2.17 | MIT                                 | https://superchupu.dev/tinyglobby                                                   |
| tinypool                                |                    2.1.0 | MIT                                 | https://github.com/tinylibs/tinypool#readme                                         |
| tinyrainbow                             |                    3.1.0 | MIT                                 | https://github.com/tinylibs/tinyrainbow#readme                                      |
| toidentifier                            |                    1.0.1 | MIT                                 | https://github.com/component/toidentifier#readme                                    |
| token-types                             |                    6.1.2 | MIT                                 | https://github.com/Borewit/token-types#readme                                       |
| totalist                                |                    3.0.1 | MIT                                 | https://github.com/lukeed/totalist#readme                                           |
| tsx                                     |                   4.23.1 | MIT                                 | https://tsx.hirok.io                                                                |
| turndown                                |                    7.2.4 | MIT                                 | https://github.com/mixmark-io/turndown#readme                                       |
| type-is                                 |                    2.1.0 | MIT                                 | https://github.com/jshttp/type-is#readme                                            |
| uint8array-extras                       |                    1.5.0 | MIT                                 | https://github.com/sindresorhus/uint8array-extras#readme                            |
| undici-types                            |                    8.3.0 | MIT                                 | https://undici.nodejs.org                                                           |
| unpipe                                  |                    1.0.0 | MIT                                 | https://github.com/stream-utils/unpipe#readme                                       |
| use-callback-ref                        |                    1.3.3 | MIT                                 | https://github.com/theKashey/use-callback-ref#readme                                |
| use-composed-ref                        |                    1.4.0 | MIT                                 | https://github.com/Andarist/use-composed-ref#readme                                 |
| use-effect-event                        |                    2.0.3 | MIT                                 | https://github.com/sanity-io/use-effect-event#readme                                |
| use-isomorphic-layout-effect            |                    1.2.1 | MIT                                 | https://github.com/Andarist/use-isomorphic-layout-effect#readme                     |
| use-latest                              |                    1.3.0 | MIT                                 | https://github.com/Andarist/use-latest#readme                                       |
| use-sidecar                             |                    1.1.3 | MIT                                 | https://github.com/theKashey/use-sidecar                                            |
| use-sync-external-store                 |                    1.6.0 | MIT                                 | https://github.com/facebook/react#readme                                            |
| util-deprecate                          |                    1.0.2 | MIT                                 | https://github.com/TooTallNate/util-deprecate                                       |
| vary                                    |                    1.1.2 | MIT                                 | https://github.com/jshttp/vary#readme                                               |
| vite-plus                               |                    0.2.5 | MIT                                 | https://viteplus.dev/guide                                                          |
| vitest                                  |                   4.1.10 | MIT                                 | https://vitest.dev                                                                  |
| why-is-node-running                     |                    2.3.0 | MIT                                 | https://github.com/mafintosh/why-is-node-running                                    |
| ws                                      |                   8.21.1 | MIT                                 | https://github.com/websockets/ws                                                    |
| xml-naming                              |                    0.3.0 | MIT                                 | https://github.com/NaturalIntelligence/xml-naming#readme                            |
| yuku-codegen                            |                   0.5.48 | MIT                                 | https://github.com/yuku-toolchain/yuku#readme                                       |
| yuku-parser                             |                   0.5.48 | MIT                                 | https://github.com/yuku-toolchain/yuku#readme                                       |
| zod                                     |                    4.4.3 | MIT                                 | https://zod.dev                                                                     |
| zustand                                 |            4.5.7, 5.0.14 | MIT                                 | https://github.com/pmndrs/zustand                                                   |
| lightningcss                            |                   1.32.0 | MPL-2.0                             | https://github.com/parcel-bundler/lightningcss#readme                               |
| lightningcss-win32-x64-msvc             |                   1.32.0 | MPL-2.0                             | https://github.com/parcel-bundler/lightningcss#readme                               |
| @yuku-codegen/binding-win32-x64         |                   0.5.48 | Unknown                             | https://github.com/yuku-toolchain/yuku#readme                                       |
| @yuku-parser/binding-win32-x64          |                   0.5.48 | Unknown                             | https://github.com/yuku-toolchain/yuku#readme                                       |
