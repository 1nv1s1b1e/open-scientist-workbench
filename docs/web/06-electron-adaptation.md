# Electron 适配方案

将 `apps/web`（Next.js）+ `apps/api`（Hono/Nitro）打包为 Electron 桌面应用。

## 结论：可行，改动量小

当前架构对 Electron 友好，主要因为：

1. **前后端分离**：`apps/api` 是独立 Hono/Nitro 服务，`apps/web` 通过 `next.config.ts` rewrites 代理 `/api/*`。Electron 只需把「代理目标」从 `http://localhost:3000` 改为内嵌服务地址。
2. **无 CORS 依赖**：后端未配 CORS，靠 Next.js 同源代理规避。Electron 里同源策略仍成立（`file://` 或 custom protocol）。
3. **无服务端文件系统硬依赖**：`apps/web` 是纯前端，不读本地文件；`apps/api` 的 `BASE_DIR` 可指向 Electron `app.getPath('userData')`。
4. **依赖原生模块少**：`apps/web` 仅 `sharp`（Next.js 图片优化，可关闭）和 `better-sqlite3`（在 `apps/api` 侧，已有 prebuild）。

## 架构

```
Electron Main Process
├─ 启动 apps/api (Nitro) 作为 child process 或内嵌
│   └─ BASE_DIR = app.getPath('userData')
├─ 创建 BrowserWindow
│   └─ 加载 apps/web (Next.js standalone build) 或 file://
└─ 生命周期管理（退出时 kill api）
```

### 方案 A：Next.js standalone + 本地 Nitro（推荐）

- `apps/web` 执行 `next build` 生成 `.next/standalone/`，用 `next start` 或 Node 直接跑
- `apps/api` 用 `nitro build` 生成单文件 server entry，main process `spawn` 启动
- BrowserWindow 加载 `http://localhost:<web-port>`，`apps/web` 的 rewrite 指向 `http://localhost:<api-port>`
- **优点**：改动最小，dev/prod 一致，SSE 流正常
- **缺点**：需管理两个端口 + 两个进程

### 方案 B：Next.js static export + 内嵌 Hono

- `apps/web` 配 `output: 'export'` 生成纯静态文件
- main process 注册 custom protocol（`app://`）serve 静态文件
- `apps/api` 内嵌为 main process 的 Node 模块（不走 HTTP，直接 import Hono app）
- **问题**：`output: 'export'` 不支持 rewrites（需要改为运行时 fetch baseURL）、不支持 SSE 流的 Next 代理（需前端直接请求 api port 或 custom protocol）
- **不推荐**：与当前 rewrites 代理架构冲突，改动大

## 需要改动的地方

### 1. `apps/web/next.config.ts`（运行时配置）

当前 rewrite 硬编码 `process.env.API_BASE_URL ?? 'http://localhost:3000'`。Electron 里：

- **方案 A**：设置 `API_BASE_URL=http://127.0.0.1:<api-port>` 即可，无需改代码
- 若要支持 `output: 'export'`，需移除 rewrites，改 `apps/web/src/lib/api/client.ts` 的 base URL 为运行时注入

### 2. `apps/api` 端口 + BASE_DIR

- 端口：Electron 启动时随机选空闲端口传给 `apps/api`（`PORT` env）
- `BASE_DIR`：设为 `app.getPath('userData')`，SQLite + 项目文件落用户数据目录

### 3. Electron main process

新增 `apps/electron/`（不在当前 10 包内，可选新增）：

```ts
// apps/electron/src/main.ts
import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'

let apiProcess: import('node:child_process').ChildProcess | null = null
let apiPort = 0

async function startApi() {
  // 随机端口
  apiPort = await getFreePort()
  const apiEntry = path.join(__dirname, '../api/dist/index.mjs')
  apiProcess = spawn('node', [apiEntry], {
    env: { ...process.env, PORT: String(apiPort), BASE_DIR: app.getPath('userData') },
    stdio: 'pipe',
  })
  // 等待 api ready（轮询 /api/health）
  await waitForHealth(`http://127.0.0.1:${apiPort}/api/health`)
}

function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 900, webPreferences: { contextIsolation: true } })
  // dev: load Next.js dev server
  // prod: load built Next.js
  win.loadURL(`http://localhost:${process.env.WEB_PORT ?? 5173}`)
}

app.whenReady().then(async () => {
  await startApi()
  createWindow()
})

app.on('before-quit', () => apiProcess?.kill())
```

### 4. `apps/web` build 适配

- 关闭图片优化（避免 sharp 原生依赖）：`next.config.ts` 加 `images: { unoptimized: true }`
- 若用 standalone build，`package.json` 加 `"build": "next build"`，产物在 `.next/standalone/`

### 5. 原生模块处理

| 模块 | 位置 | 处理 |
|---|---|---|
| `better-sqlite3` | apps/api | electron-builder 自动 rebuild（`electron-rebuild`），或用 `@electron/rebuild` |
| `sharp` | apps/web | 关闭 `images.unoptimized` 后可移除，或 `pnpm approve-builds` 允许 |
| `three` | apps/web | 纯 JS，无原生依赖，无需处理 |

## electron-builder 配置示例

```json
{
  "appId": "com.open-scientist.app",
  "directories": { "output": "release" },
  "files": [
    "apps/electron/dist/**",
    "apps/api/dist/**",
    "apps/web/.next/standalone/**",
    "apps/web/.next/static/**",
    "apps/web/public/**"
  ],
  "mac": { "target": "dmg" },
  "win": { "target": "nsis" },
  "linux": { "target": "AppImage" }
}
```

## 打包流程

```bash
# 1. 构建 api
pnpm --filter @open-scientist/api build

# 2. 构建 web (standalone)
pnpm --filter @open-scientist/web build

# 3. 构建 electron main
pnpm --filter @open-scientist/electron build

# 4. 打包
electron-builder
```

## 风险与注意

1. **SSE 流**：Electron 的 `BrowserWindow` 里的 Chromium 完整支持 SSE，无需特殊处理。方案 A 通过 HTTP 代理，流式传输正常。
2. **进程管理**：api 进程崩溃需 main process 监听 `exit` 事件并重启 + 通知前端。可用 Electron `ipcMain` + renderer `ipcRenderer` 通信。
3. **端口冲突**：随机端口方案需等待 api 就绪后再加载 web。轮询 `/api/health` 或监听 stdout ready 信号。
4. **auto-update**：electron-updater 可集成，但 `apps/api` 和 `apps/web` 的更新需同步。建议整包更新。
5. **Node 版本**：Electron 内置 Node 版本可能与系统 Node 26 不一致。`apps/api` 若用了 Node 26 特性（如 type stripping），需确认 Electron 内置版本兼容，或用 `nitro build` 预编译为 ES2022。
6. **DevTools**：开发期 `win.webContents.openDevTools()`，生产可按需关闭。

## 工作量估算

| 任务 | 工作量 |
|---|---|
| 新建 `apps/electron/`（main + preload + builder 配置） | 1 天 |
| `apps/api` nitro build 适配（确保单文件 entry） | 0.5 天 |
| `apps/web` standalone build + images.unoptimized | 0.5 天 |
| 进程管理 + 健康检查 + 端口分配 | 0.5 天 |
| electron-builder 配置 + 多平台测试 | 1 天 |
| **合计** | **~3.5 天** |

## 不需要改动的部分

- `apps/web/src/lib/api/client.ts` — fetch 调用不变，base URL 通过 env 注入
- `apps/web/src/lib/hooks/useRunStream.ts` — SSE 消费逻辑不变
- `apps/api/src/**` — 路由/业务逻辑不变，仅 build 方式调整
- 所有 `packages/**` — 不变
