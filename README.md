# Open-Scientist

> 太阳物理多智能体人机协同假设生成与证据推理系统
> 赛道一方向二 B：日冕加热之谜
> 基于 Google Co-Scientist (Nature, 2026) + AlphaEvolve 架构

6 个自定义角色 Agent 协同的"分布式科学共同体"，对日冕加热等前沿课题执行 **Tournament Evolution**（假设生成 → 证据审查 → 锦标赛辩论 → 多轮规划）循环，最终输出 MHD 仿真配置 + 卫星观测建议书。支持人机协同介入（物理学家审查领先假设并注入专家直觉）。

## 技术栈

Node.js + pnpm + TypeScript 6 + Vite+（Oxlint + Oxfmt + Vitest）+ Zod 4 + Hono + `@hono/node-server` + AI SDK 7（`ai`，含 `ToolLoopAgent`）+ Drizzle ORM（双 SQLite）+ HelixDB（本地 graph+vector）+ `bash-tool` + `@ai-sdk/mcp`。

## Monorepo 结构

```
apps/
  api/        — Hono + @hono/node-server REST API
  web/        — Next.js 16 + React 19 + assistant-ui 前端
packages/
  agents/     — 6 ToolLoopAgent（sisyphus/librarian/looker/explore/oracle/prometheus）
  tools/      — bash/helix-query/fits-align/mhd-config/load-skill
  skills/     — discover + prompt + load-tool（agentskills.io 开放格式）
  mcp/        — MCP server registry + 自动信任
  storage/    — 双 SQLite（global + per-project）+ Drizzle + 8 repo
  helix/      — HelixDB client + queries DSL
  schema/     — Zod schemas（零业务依赖）
  config/     — paths + settings 两层 merge + models
  logger/     — consola wrapper + 11 个预定义 tag
```

## 6 Agent 角色

| 角色              | 职责                                                   | Output Schema       |
| ----------------- | ------------------------------------------------------ | ------------------- |
| Sisyphus          | 编排器，tournamentWorkflow 纯确定性控制流调 5 子 agent | TournamentResult    |
| Librarian         | RAG 检索（HelixDB）+ 初始假设生成                      | HypothesisPool      |
| Multimodal Looker | FITS 图像 + MP4 视频对齐                               | EvidenceAlignment   |
| Explore           | bash-tool 跑 Python 在 1.75M 快照搜索，算 F1           | EvalResult          |
| Oracle            | Co-Scientist 批判 + 突变 + 反例 debug                  | Critique + Mutation |
| Prometheus        | 多轮规划，末轮输出 MHD .cfg + 观测建议书               | Plan + MhdConfig    |

## 快速开始

### 前置依赖

- Node.js 24+（本机 `v24.13.1` 已验证；`.node-version` 中的 26.5.0 为可选升级版本）
- pnpm 11+（见 `package.json` `packageManager`）
- Vite+ CLI：优先使用项目内 `node_modules\.bin\vp.CMD`；没有 `node_modules` 时先用 Corepack pnpm 安装依赖
- HelixDB 本地实例（默认 `http://127.0.0.1:6969`）
- Python 3.11+ + `uv`（Explore agent 的 eval 脚本需要 numpy/scipy）

### 安装

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
Set-Location -LiteralPath $ProjectRoot
$Vp = Join-Path $ProjectRoot 'node_modules\.bin\vp.CMD'
if (-not (Test-Path -LiteralPath $Vp)) {
  corepack pnpm install --frozen-lockfile
}
& $Vp install
```

### 配置

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
Set-Location -LiteralPath $ProjectRoot
if (-not (Test-Path -LiteralPath .\.env)) {
  Copy-Item -LiteralPath .\.env.example -Destination .\.env
}
# 编辑 .env 设置 BASE_DIR / PORT / HELIX_URL / LOG_LEVEL /
# CREDENTIAL_ENCRYPTION_KEY（本机固定保存，不要提交）
```

模型配置通过 Web API + SQLite 存储，不走 .env。启动后在 Settings 页面添加 credential（API key + baseURL）并绑定到 agent role。
第三方 OpenAI 兼容网关使用 `provider=openai` 和自定义 `baseURL`；Anthropic 兼容端点使用 `provider=anthropic`。占位字段见 [docs/third-party-api.placeholder.md](docs/third-party-api.placeholder.md)。

### 开发

推荐在仓库根目录使用一键脚本。它会在后台启动 API（3002）和 Web（5173），统一前后端 API 地址，等待健康检查，并将 PID 与日志写入 `.runtime/local-services/`：

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
Set-Location -LiteralPath $ProjectRoot
corepack pnpm local:start
```

启动后打开 `http://localhost:5173`；现有真实 Qwen 演示可直接打开 `http://localhost:5173/projects/scientific-thinking-demo`。停止服务：

```powershell
corepack pnpm local:stop
```

如果需要同时启动 HelixDB 图数据库，使用 `corepack pnpm local:start:helix`。首次启动前必须在本机 `.env` 或当前 PowerShell 会话中设置原有的固定 `CREDENTIAL_ENCRYPTION_KEY`；不要为已有 `data/global.sqlite` 临时生成新密钥，否则保存的模型凭证将无法解密。

以下为手动启动方式。

终端 T1（HelixDB）：

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
$Helix = Join-Path $env:USERPROFILE '.local\bin\helix.exe'
Set-Location -LiteralPath $ProjectRoot
if (-not (Test-Path -LiteralPath .\helix.toml)) {
  & $Helix init local --path $ProjectRoot --name dev --port 6969 --no-skills --quiet
}
& $Helix start
```

终端 T2（API）：

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
$Vp = Join-Path $ProjectRoot 'node_modules\.bin\vp.CMD'
Set-Location -LiteralPath $ProjectRoot
$env:PORT = '3002'
$env:CREDENTIAL_ENCRYPTION_KEY = '<本机固定的加密密钥>'
& $Vp dev
```

终端 T3（Web）：

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
Set-Location -LiteralPath $ProjectRoot
corepack pnpm --filter @open-scientist/web dev
```

`apps/web/.env.local` 中的 `API_BASE_URL` 与 `NEXT_PUBLIC_API_BASE_URL` 必须都指向同一个 API（本地演示为 `http://127.0.0.1:3002`）。开发模式请打开 `http://localhost:5173`；不要把 Web 地址改成 `127.0.0.1`，否则 Next.js 开发 HMR 可能无法完成握手。

### 验证

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
Set-Location -LiteralPath $ProjectRoot
$Vp = Join-Path $ProjectRoot 'node_modules\.bin\vp.CMD'
& $Vp check                # format + lint + typecheck 一条命令
& $Vp test run             # 运行全部测试
& $Vp run -r typecheck     # 全 11 包 tsc --noEmit
```

### 数据库

```powershell
$ProjectRoot = 'C:\vscode_project\ali_competition\scientist_code\open-scientist'
Set-Location -LiteralPath $ProjectRoot
$Vp = Join-Path $ProjectRoot 'node_modules\.bin\vp.CMD'
& $Vp run --filter @open-scientist/storage db:generate    # 生成 migration SQL（schema 变更后执行）
```

## Tournament Evolution 工作流

```
Round 1: Librarian 生成假设
    ↓
Loop:
    Explore 并行评估（Promise.all）
    ↓
    Oracle 批判 + 突变
    ↓
    Prometheus 规划下一轮参数
    ↓
    收敛检测（F1 ≥ 0.9 / round ≥ 10 / 收敛）
    ↓ (未收敛)
    下一轮
    ↓ (收敛)
Prometheus 输出 MHD .cfg + 卫星观测建议书
```

## 文档

- [SPEC.md](SPEC.md) — 完整技术规格
- [PROGRESS.md](PROGRESS.md) — 开发进度与计划
- [AGENTS.md](AGENTS.md) — Agent 开发指南（AI 编程助手用）
- [docs/web/](docs/web/) — Web 前端设计文档
- [DESIGN.md](DESIGN.md) — 系统设计文档

## License

Private
