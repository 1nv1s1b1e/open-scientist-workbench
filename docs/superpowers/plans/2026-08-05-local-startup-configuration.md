# Local Startup Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows checkout at `C:\vscode_project\ali_competition\scientist_code\open-scientist` reproducibly configurable and verifiable from `C:\vscode_project\ali_competition\STARTUP.md`, while keeping third-party credentials as non-runtime placeholders.

**Architecture:** Keep project configuration under the actual Open-Scientist root, use the project-local Vite+ executable and Corepack pnpm, and keep Helix's generated `helix.toml`/`.helix` state local and ignored. Install missing developer runtimes only under the current user's scoped directory; do not alter read-only datasets, existing containers, source secrets, or model credentials.

**Tech Stack:** Windows PowerShell, Node.js 24.13.1 (with optional Node.js 26.5.0), Corepack/pnpm 11.15.1, Vite+ local CLI, Helix CLI 3.0.8, Docker Desktop, SQLite credential storage, and the existing Open-Scientist verification commands.

---

### Task 1: Normalize the project-root startup commands

**Files:**

- Modify: `C:\vscode_project\ali_competition\STARTUP.md`
- Modify: `C:\vscode_project\ali_competition\scientist_code\open-scientist\README.md`
- Modify: `C:\vscode_project\ali_competition\scientist_code\open-scientist\.env.example`
- Create: `C:\vscode_project\ali_competition\scientist_code\open-scientist\docs\third-party-api.placeholder.md`

- [ ] Use `C:\vscode_project\ali_competition\scientist_code\open-scientist` as `$ProjectRoot`, `node_modules\.bin\vp.CMD` as `$Vp`, `%USERPROFILE%\.local\bin\helix.exe` as `$Helix`, `apps\web` as the Web directory, and `data\dataset\.venv` as the Explore environment.
- [ ] Keep `.env` out of Git, leave `CREDENTIAL_ENCRYPTION_KEY` as a local-only value, and keep third-party provider/key/baseURL/model fields in the non-runtime placeholder document.
- [ ] Make the Helix sequence idempotent: run `helix init local --path C:\vscode_project\ali_competition\scientist_code\open-scientist --name dev --port 6969 --no-skills --quiet` only when `helix.toml` is absent, then run `helix start`.

### Task 2: Keep the verified Node.js runtime local and optional

**Files:**

- Modify: `C:\vscode_project\ali_competition\STARTUP.md`
- Modify: `C:\vscode_project\ali_competition\scientist_code\open-scientist\README.md`
- Create: `C:\Users\12201\.local\node-v26.5.0-win-x64\` from the official Node.js archive

- [x] Preserve the existing system Node.js `v24.13.1`; fresh project checks have already passed with this runtime.
- [x] Optionally keep `C:\Users\12201\.local\node-v26.5.0-win-x64` available after verifying SHA-256 `d3b2277dbcccfdf24ef6302928f64f484cff1d77a6d3caa3a28f4d20ce9158f6`; do not prepend it by default or replace the system Node installation.

### Task 3: Initialize and start the local Helix instance

**Files:**

- Create local ignored state: `C:\vscode_project\ali_competition\scientist_code\open-scientist\helix.toml`
- Create local ignored state: `C:\vscode_project\ali_competition\scientist_code\open-scientist\.helix\`

- [ ] Verify Docker Desktop's engine is running with `docker info`.
- [ ] Start the configured `dev` instance on `http://localhost:6969` using the official Helix CLI and the generated Docker image configuration.
- [ ] Verify both `helix status` and `Invoke-RestMethod http://localhost:6969/health` before treating Helix as running.
- [ ] If the Docker registry path remains blocked, preserve the exact error and leave existing unrelated Docker containers untouched.

### Task 4: Install dependencies and prepare the Explore environment

**Files:**

- Local dependency state under `C:\vscode_project\ali_competition\scientist_code\open-scientist\node_modules\`
- Local venv under `C:\vscode_project\ali_competition\scientist_code\open-scientist\data\dataset\.venv\`

- [ ] Run `corepack pnpm install --frozen-lockfile` only when the local Vite+ executable is absent, then run `C:\vscode_project\ali_competition\scientist_code\open-scientist\node_modules\.bin\vp.CMD install`.
- [ ] Create `data\dataset\.venv` with `uv venv` if its Python executable is absent, then install `numpy` and `scipy` into that exact venv.
- [ ] Do not create `.env`, `data\global.sqlite`, or credential records until a stable local encryption key is deliberately supplied.

### Task 5: Run fresh verification and record remaining external inputs

**Files:**

- No source-code changes.

- [ ] Run `C:\vscode_project\ali_competition\scientist_code\open-scientist\node_modules\.bin\vp.CMD lint`.
- [ ] Run `C:\vscode_project\ali_competition\scientist_code\open-scientist\node_modules\.bin\vp.CMD test run`.
- [ ] Run `C:\vscode_project\ali_competition\scientist_code\open-scientist\node_modules\.bin\vp.CMD run -r typecheck`.
- [ ] Run outer verification from `C:\vscode_project\ali_competition`: `python -m pytest -q` and `$env:PYTHONPATH='src'; python -m jinwu run --request examples/jwfd_demo_request.json`.
- [ ] Report any formatter-only failure separately from test/typecheck failures, and report missing third-party `api-key`, `baseURL`, and model name as explicit external inputs rather than inventing values.
