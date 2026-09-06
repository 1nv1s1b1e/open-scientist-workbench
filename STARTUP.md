# 启动命令

> 前置：Node.js 26+、pnpm 11+、Vite+ CLI（`npm i -g vite-plus`）、OrbStack/Docker、HelixDB CLI、Python 3.11+ + uv

## 1. 环境变量

```bash
cp .env.example .env
```

`.env` 内容（已默认配好，无需改动）：

```
BASE_DIR=./data
PORT=3000
HELIX_URL=http://localhost:6969
LOG_LEVEL=info
```

## 2. 安装依赖

```bash
vp install
```

## 3. 启动 HelixDB（graph + vector 数据库）

需先启动 Docker（macOS 推荐 OrbStack，Linux 原生安装，Windows 用 Docker Desktop）。

```bash
helix start
```

- URL：http://localhost:6969
- 容器名：`helix-helix-project-dev`
- 停止：`helix stop`
- 首次初始化（已执行过可跳过）：`helix init local --path . --no-skills --quiet`

## 4. 启动 API 服务（Hono + tsx watch）

```bash
vp run --filter @open-scientist/api dev
```

- URL：http://localhost:3000
- 健康检查：`curl http://localhost:3000/api/health`
- 热重载：tsx watch，改代码自动重启

## 5. 启动 Web 前端（Next.js 16）

新开一个终端：

```bash
cd apps/web && npx next dev -p 5173
```

- URL：http://localhost:5173
- API 请求通过 `next.config.ts` rewrites 代理到 `http://localhost:3000`

## 6. 模型配置（首次启动后）

模型配置走 Web API + SQLite，**不进 .env**。

1. 打开 http://localhost:5173/settings
2. 添加 Credential（API key + baseURL + provider）
3. 在「模型配置」Tab 绑定 credential 到 agent role（sisyphus/librarian/looker/explore/oracle/prometheus）
4. 可选：设置 model alias（在 Settings 页或 `GET/PUT/DELETE /api/settings/model-aliases/:alias`）

## 7. 一键启动顺序（三个终端）

| 终端 | 命令                                      | 作用             |
| ---- | ----------------------------------------- | ---------------- |
| T1   | `helix start`                             | 启动 HelixDB     |
| T2   | `vp run --filter @open-scientist/api dev` | 启动 API (:3000) |
| T3   | `cd apps/web && npx next dev -p 5173`     | 启动 Web (:5173) |

## 验证命令

```bash
vp check                  # format + lint + typecheck
vp test run               # 全部测试
vp run -r typecheck       # 全 11 包 tsc --noEmit
curl http://localhost:3000/api/health   # API 健康检查
curl http://localhost:6969/health       # HelixDB 健康检查
```

## 停止服务

```bash
helix stop                          # 停 HelixDB
pkill -f 'tsx.*server'              # 停 API
# Web: Ctrl+C in T3
```

## 数据库 Migration（schema 变更后）

```bash
vp run --filter @open-scientist/storage db:generate
```

## Python venv（Explore agent 用）

```bash
# data/dataset/.venv 已存在则跳过
uv venv data/dataset/.venv
uv pip install --python data/dataset/.venv/bin/python numpy scipy
```
