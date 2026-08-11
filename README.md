# Open-Scientist

太阳物理多智能体假设生成与证据推理系统。当前日冕科学 pipeline 接收结构化现象，组织检索、数据处理、假设生成、证据审查、验证规划和综合结论，并在运行目录中保存可追溯的中间结果。

仓库包含运行 pipeline 所需的源码、测试、数据库迁移、启动脚本和公开数据下载脚本。约 7.374 GB 的 SDO FITS 数据、模型凭据和本地运行记录不进入 Git，需要在首次运行时单独准备。

## 仓库内容

```text
apps/
  api/        Hono REST/SSE API
  web/        Next.js 前端与科学工作台
packages/
  agents/     多智能体工作流与科学循环
  config/     路径、模型和运行配置
  helix/      HelixDB 客户端
  mcp/        MCP server registry
  schema/     Zod 数据契约
  skills/     Agent skills
  storage/    SQLite schema、migration 和 repository
  tools/      数据、bash、Helix 和科学工具
scripts/
  fetch_coronal_starter.py   下载并校验公开 SDO 数据
  analyze_coronal_window.py  处理本地日冕观测窗口
  start-local.ps1            启动 API 和 Web
  stop-local.ps1             停止本地服务
```

## 运行模式

- `local-grounded`：使用本地数据和确定性服务跑通科学 pipeline，不调用模型 API。适合安装验证和演示。
- `model-assisted`：在同一条 pipeline 中调用配置好的模型完成角色分析、审查、规划和综合。需要 credential 和角色模型配置。

两种模式都需要 `coronal-starter-v1` 数据。只有旧的 Tournament/JW-FD 工作流需要 `dataset_manifest.json`、`snapshots.jsonl` 和 `targets.jsonl`；当前日冕科学 pipeline 不依赖这些旧数据。

## 1. 前置条件

推荐在 Windows PowerShell 中运行。

- Node.js 24 或更高版本；仓库 `.node-version` 给出推荐版本。
- Corepack 和 pnpm 11.15.1；pnpm 版本锁定在 `package.json`。
- Python 3.11 或更高版本。
- `curl`；Windows 10/11 通常已经包含 `curl.exe`。
- 至少 10 GB 可用磁盘空间：数据约 7.374 GB，剩余空间用于数据库、日志和处理产物。
- 可用的模型 endpoint，仅 `model-assisted` 模式需要。
- HelixDB 可选；基础本地 pipeline 可以先不启动 HelixDB。

确认环境：

```powershell
node --version
corepack --version
python --version
curl.exe --version
```

## 2. 获取代码和安装依赖

从团队分支 clone：

```powershell
git clone --branch feature/ymy-branch --single-branch https://github.com/asckaya/open-scientist.git
Set-Location open-scientist
```

也可以从团队私有仓库 clone：

```powershell
git clone git@github.com:1nv1s1b1e/open-scientist-workbench.git
Set-Location open-scientist-workbench
```

安装 Node.js 依赖：

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
```

为 FITS 处理建立 Python 虚拟环境：

```powershell
python -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install numpy scipy astropy
$env:PYTHON_EXECUTABLE = (Resolve-Path .\.venv\Scripts\python.exe).Path
```

启动服务和运行 pipeline 时，应在同一 PowerShell 会话中保留 `PYTHON_EXECUTABLE`。如果系统默认 `python` 已安装上述依赖，可以省略该变量。

## 3. 配置本地环境

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
BASE_DIR=./data
PORT=3000
HELIX_URL=http://127.0.0.1:6969
LOG_LEVEL=info
API_BASE_URL=http://127.0.0.1:3000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3000
CREDENTIAL_ENCRYPTION_KEY=__REPLACE_WITH_A_STABLE_LOCAL_SECRET__
```

必须替换 `CREDENTIAL_ENCRYPTION_KEY`。它用于加密 `data/global.sqlite` 中的模型凭据：

- 使用随机、稳定且仅保存在本机的值。
- 不要把真实密钥提交到 Git。
- 创建 credential 后不要更换该值，否则已有凭据无法解密。
- 新 clone 不需要复制其他人的 `global.sqlite`；应用会创建本机数据库。

一键启动脚本默认使用 API 端口 3002 和 Web 端口 5173，并在启动子进程时设置正确的 API 地址。因此 `.env` 中的 3000 是手动启动默认值，不影响一键启动的 3002。

## 4. 下载日冕数据

数据来自公开的 Stanford JSOC SDO archive。下载脚本先查询文件大小，确保总量不超过 9.3 GB 预算，再下载和计算 SHA-256。

只生成计划并查看预计体积：

```powershell
python scripts/fetch_coronal_starter.py --plan
```

下载完整数据：

```powershell
python scripts/fetch_coronal_starter.py --download --download-workers 4
```

当前完整数据包含：

- 704 个 FITS 文件；
- 720 条逻辑观测；
- SDO/AIA 94、131、171、193、211、335 Å；
- SDO/HMI 视向磁图；
- 计划体积 7.37387136 GB，即约 6.867 GiB；
- 三个有界观测案例。

默认目录必须是：

```text
data/
└── dataset/
    └── coronal-starter-v1/
        ├── manifest.json
        ├── README.md
        └── raw/
            ├── aia/
            └── hmi/
```

脚本会在 `manifest.json` 中记录每个文件的来源 URL、JSOC 查询、质量标记、字节数和 SHA-256。再次执行 `--download` 时，脚本会校验大小和哈希，并跳过已经正确下载的文件。

### 将数据放到独立磁盘

`DATASET_DIR` 应指向包含 `coronal-starter-v1` 的父目录：

```powershell
$env:DATASET_DIR = 'D:\open-scientist-data'
python scripts/fetch_coronal_starter.py `
  --download `
  --output (Join-Path $env:DATASET_DIR 'coronal-starter-v1')
```

最终路径应为：

```text
D:\open-scientist-data\coronal-starter-v1\manifest.json
```

运行服务时也要在同一会话中设置相同的 `DATASET_DIR`。

## 5. 启动服务

推荐使用一键启动：

```powershell
corepack pnpm local:start
```

该脚本会：

1. 读取 `.env`；
2. 检查 `CREDENTIAL_ENCRYPTION_KEY`；
3. 在缺少 `node_modules` 时安装依赖；
4. 启动 API，默认监听 `http://127.0.0.1:3002`；
5. 启动 Web，默认监听 `http://localhost:5173`；
6. 等待健康检查；
7. 将 PID 和日志写入 `.runtime/local-services/`。

打开：

```text
http://localhost:5173
```

停止服务：

```powershell
corepack pnpm local:stop
```

自定义端口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-local.ps1 `
  -ApiPort 3003 `
  -WebPort 5174
```

如果已经安装并初始化 HelixDB：

```powershell
corepack pnpm local:start:helix
```

## 6. 配置模型

`local-grounded` 模式可以跳过本节。`model-assisted` 模式通过 Web Settings 和本机 SQLite 保存配置，API key 不写入 `.env`。

启动后打开 Settings：

1. 在 Credentials 中添加 endpoint。
2. 设置 credential ID，例如 `qwen-gateway`。
3. OpenAI 或 OpenAI-compatible endpoint 选择 `provider=openai`。
4. 填写 API key；第三方网关填写完整 `baseURL`，通常以 `/v1` 结尾。
5. Anthropic endpoint 选择 `provider=anthropic`。
6. 在模型配置中为角色填写 model、thinking level、API mode 和 credential ID。

OpenAI-compatible Qwen 网关通常使用：

```text
provider:      openai
model:         <网关实际提供的模型名>
baseURL:       https://<gateway-host>/v1
apiMode:       chat
credentialId: <刚创建的 credential ID>
```

至少配置以下角色，或提供可供它们回退的默认模型配置：

```text
sisyphus
librarian
looker
explore
oracle
prometheus
```

不要把一个网关或模型的成功运行当作另一个网关或模型已经验证。每次更换 endpoint、credential 或 model 后，应创建新 run 并检查实际 provider/model 记录。

## 7. 运行 pipeline

### 无模型的安装验证

1. 打开 `http://localhost:5173`。
2. 创建一个新项目。
3. 输入结构化太阳活动现象和待研究问题。
4. 选择 `local-grounded`。
5. 启动 run。

该模式读取 `coronal-starter-v1`，执行 discovery、validation、证据整理和综合流程，但不证明任何真实日冕加热机制。

### 模型辅助运行

完成 Settings 配置后：

1. 创建或打开项目。
2. 输入现象、活动区、观测信息和研究问题。
3. 选择 `model-assisted`。
4. 选择需要的 model alias；未使用 alias 时读取角色模型配置。
5. 设置轮数并启动 run。
6. 在工作台检查 A–D 阶段、假设、证据、验证队列和最终综合结果。

运行数据保存在：

```text
data/projects/<project>/
├── db.sqlite
├── runs/<run-id>/science-loop.jsonl
└── workspace/scientific-processing/<run-id>/
```

## 8. 验证代码

```powershell
corepack pnpm exec vp run -r typecheck
corepack pnpm exec vp test run
```

数据处理冒烟测试可以直接调用 Python 脚本：

```powershell
python scripts/analyze_coronal_window.py `
  --manifest data/dataset/coronal-starter-v1/manifest.json `
  --dataset-root data/dataset/coronal-starter-v1 `
  --case-id ar11158-window-20110215 `
  --output-dir output/coronal-smoke `
  --mode discovery
```

如果设置了 `DATASET_DIR`，将上面的 manifest 和 dataset-root 替换为对应绝对路径。

## 9. 常见问题

### `CREDENTIAL_ENCRYPTION_KEY is not configured`

复制 `.env.example` 为 `.env`，然后将占位符替换为稳定的本机密钥。

### `manifest.json` 或 FITS 文件不存在

确认以下文件存在：

```text
data/dataset/coronal-starter-v1/manifest.json
```

如果使用 `DATASET_DIR`，它必须指向数据集目录的父目录，并且启动服务的 PowerShell 会话也必须设置该变量。

### `curl is required`

确保 `curl.exe` 在 `PATH` 中，然后重新执行下载命令。

### `No module named astropy`、`numpy` 或 `scipy`

激活 `.venv`，安装 Python 依赖，并设置 `PYTHON_EXECUTABLE`。

### 3002 或 5173 端口被占用

先执行 `corepack pnpm local:stop`，或使用 `start-local.ps1` 的 `-ApiPort`、`-WebPort` 参数选择其他端口。

### 模型配置找不到或 credential 无法解密

确认角色模型引用了存在的 credential ID，并确认当前 `CREDENTIAL_ENCRYPTION_KEY` 与创建 credential 时一致。无法恢复原密钥时，应删除失效 credential 并重新添加，而不是复制其他人的 SQLite 凭据库。

## 10. 不进入仓库的本地内容

以下内容由用户下载、配置或运行时生成，不应提交：

```text
.env
.runtime/
.playwright-cli/
data/
output/
```

尤其不要提交：

- `data/global.sqlite*`；
- `data/settings.json`；
- `data/projects/`；
- API key、OAuth token 或 credential encryption key；
- 本机日志、截图和模型运行历史。

## 开发文档

- [SPEC.md](SPEC.md)：完整技术规格。
- [DESIGN.md](DESIGN.md)：系统设计。
- [AGENTS.md](AGENTS.md)：Agent 开发指南。
- [docs/web/](docs/web/)：Web 前端设计。

## License

Private
