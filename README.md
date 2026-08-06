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

- Node.js 26+（见 `.node-version`）
- pnpm 11+（见 `package.json` `packageManager`）
- Vite+ CLI：`npm i -g vite-plus`
- HelixDB 本地实例（默认 `http://localhost:6969`）
- Python 3.11+ + `uv`（Explore agent 的 eval 脚本需要 numpy/scipy）

### 安装

```bash
vp install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env 设置 BASE_DIR / PORT / HELIX_URL / LOG_LEVEL
```

模型配置通过 Web API + SQLite 存储，不走 .env。启动后在 Settings 页面添加 credential（API key + baseURL）并绑定到 agent role。

### 开发

```bash
vp run --filter @open-scientist/api dev  # 启动 API（tsx watch，默认 :3000）
cd apps/web && npx next dev -p 5173   # 启动 Web 前端
```

### 验证

```bash
vp check                  # format + lint + typecheck 一条命令
vp test run               # 运行全部测试
vp run -r typecheck       # 全 11 包 tsc --noEmit
```

### 数据库

```bash
vp run --filter @open-scientist/storage db:generate    # 生成 migration SQL（schema 变更后执行）
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
