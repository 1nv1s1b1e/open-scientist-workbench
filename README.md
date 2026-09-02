# Open-Scientist

太阳物理多智能体假设生成与证据推理系统。当前日冕科学 pipeline 接收结构化现象，组织检索、数据处理、假设生成、证据审查、验证规划和综合结论，并在运行目录中保存可追溯的中间结果。

仓库包含运行 pipeline 所需的源码、测试、数据库迁移、启动脚本和公开数据下载脚本。最小 starter 数据约 7.374 GB；当前完整证据包包含多事件 AIA/HMI、HMI SHARP 矢量磁场、IRIS/EIS 光谱和 NuSTAR 定向硬 X 射线输入，共 65.514 GB（约 61.015 GiB）。两者、模型凭据和本地运行记录均不进入 Git，需要在首次运行时单独准备。当前实现与实测边界见 [方向 2B 后端与数据最终说明](docs/competition-2b-final-backend-and-data.md)。

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
  fetch_hmi_sharp_vector.py  按事件下载并校验 HMI SHARP CEA 矢量磁场
  fetch_targeted_discriminants.py  下载并登记 EIS/IRIS/NuSTAR 机制判别补充包
  analyze_coronal_window.py  处理本地日冕观测窗口
  process_coronal_pack.py    批量诊断、特征、压缩审计和辅助模型
  build_eis_density_calibration.py  用 ChiantiPy+CHIANTI 构建并注册 Si X 密度曲线
  analyze_eis_level1.py      EIS Level-1 版本化谱线拟合、密度与非热速度
  analyze_iris_ar11890.py    AR11890 IRIS 方法复现
  analyze_nustar_hxr.py      NuSTAR 计数率链与几何/指向审计
  run-scientific-demo.ps1    一键执行并导出核心科学结果
  start-local.ps1            启动 API 和 Web
  stop-local.ps1             停止本地服务
outputs/
  ar11158-qwen-demo/         脱敏的真实 Qwen 运行示例
sources/
  coronal-heating-corpus-v1.json  本地核验文献元数据与受控注释
```

核心文献语料随仓库提供，当前包含 80 篇去重且已核验的日冕加热论文记录，覆盖热过程、波动、纳耀斑/重联、硬 X 射线、光谱、反例和前向模型，已达到 80–150 篇冻结区间下限并通过分层覆盖审计。每条保存题名、作者、年份、DOI/公开来源、受控注释和证据边界。`node scripts/audit-literature-corpus.ts --require-freeze-ready` 会检查数量、分层覆盖、必填元数据和重复 ID/题名/DOI。检索工具还会联合 Helix/本地语料与免费的 OpenAlex、Crossref 元数据 API，并把 provider、来源链接、检索时间和缓存状态返回给文献溯源智能体；网络不可用时回退到 7 天缓存和本地语料。外部论文只用于提出假设、预测、替代解释和反例线索，不能直接创建观测 `support`。仓库不分发论文 PDF 全文；需要阅读全文时，应通过记录的 DOI 或公开来源获取。

## 科学智能体职责名称

用户界面和新运行产物使用"代号 · 中文职责"的双身份制：**Librarian·文献溯源**、**Looker·观测质控**、**Explorer·物理诊断**、**Oracle·反证审计**、**Prometheus·验证设计**、**Sisyphus·闭环协调**。完整的身份表（英文键、代号、中英文显示名、A–D 阶段与职责）定义在 `packages/schema/src/scientific-agent-names.ts`。为了兼容旧配置、数据库和已保存运行，`librarian`、`looker`、`explore`、`oracle`、`prometheus`、`sisyphus` 仍是持久化的内部稳定键。

## 运行模式

- `local-grounded`：使用本地数据和确定性服务跑通科学 pipeline，不调用模型 API。适合安装验证和演示。
- `model-assisted`：在同一条 pipeline 中调用配置好的模型完成角色分析、审查、规划和综合。需要 credential 和角色模型配置。

两种模式至少需要 `coronal-starter-v1`；完整评测应设置 `CORONAL_DATASET_ID=coronal-evidence-70gb-v1`。只有旧的 Tournament/JW-FD 工作流需要 `dataset_manifest.json`、`snapshots.jsonl` 和 `targets.jsonl`；当前日冕科学 pipeline 不依赖这些旧数据。

## 1. 前置条件

推荐在 Windows PowerShell 中运行。

- Node.js 24 或更高版本；仓库 `.node-version` 给出推荐版本。
- Corepack 和 pnpm 11.15.1；pnpm 版本锁定在 `package.json`。
- Python 3.11 或更高版本。
- `curl`；Windows 10/11 通常已经包含 `curl.exe`。
- starter 模式至少 10 GB 可用空间；完整证据包建议预留 72–75 GB，以容纳 65.514 GB 原始层及缓存、数据库和运行产物。
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
python -m pip install -r requirements.txt
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
CREDENTIAL_ENCRYPTION_KEY=__SET_A_STABLE_LOCAL_SECRET__
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
        ├── derived/
        │   └── reduced-frame-v1/  # 首次分析后按需生成，不进入 Git
        └── raw/
            ├── aia/
            └── hmi/
```

脚本会在 `manifest.json` 中记录每个文件的来源 URL、JSOC 查询、质量标记、字节数和 SHA-256。再次执行 `--download` 时，脚本会校验大小和哈希，并跳过已经正确下载的文件。

### 预处理、缓存与原始数据保留

`analyze_coronal_window.py` 会先拒绝登记为非零 `QUALITY` 的帧，再执行曝光时间归一化、有限值掩膜和确定性降采样。下载器会从原始 JSOC record 查询 HMI 的 WCS、时间、BUNIT 和日地距离，写入带 SHA-256 的 `metadata/hmi-records-v1.json` 旁车；原始 FITS 不被改写。降采样帧按“预处理版本 + 目标尺寸 + 原始文件 SHA-256 + 元数据摘要”缓存在 `derived/wcs-roi-dem-v3/`。当前每条流不超过 96 帧时使用全部登记帧，更大的流才均匀限采样到 96 帧。

每次处理产物的 `preprocessing` 字段会报告原始数据字节数、实际引用字节数、缓存字节数、命中率、质量拒绝数和压缩比例；`analysisDesign.scientificResultFingerprint` 用于核对缓存冷/热运行是否得到同一科学结果。实测 AR11429 留出案例的 190 个原始 FITS 共 1.8748656 GB，派生缓存约 14.14 MB，即原始引用量的约 0.754%；完整 704 文件缓存约 58.16 MB，为全体原始数据的约 0.789%。

这些派生帧是有损工作层，不能替代原始 FITS。当前处理器已实现统一 193 Å WCS/ROI（含差分自转补偿，`wcs-roi-dem-v4`）、预注册冷却时延、六通道 ROI 中位强度正则化 DEM、空间相干与表观传播、热事件 fluence 分布、HMI 共空间视向磁场、SHARP CEA 矢量磁场、磁—热时间关联代理，以及 AR11899 IRIS Si IV Doppler 正控复现。EIS Level-1 版本化拟合（v2）在冻结校准下输出六条谱线的强度、相对 Doppler、非热速度，以及由注册 CHIANTI 11.0.2 密度曲线反演的 Si X 258/261 电子密度（曲线经 Warren 2009 发表锚点验证，偏差约 0.11 dex；`scripts/build_eis_density_calibration.py` 构建并注册，`analyze_eis_level1.py` 校验消费）。NuSTAR 计数率链（`analyze_nustar_hxr.py` v2）提供逐观测的指向/ghost-ray 审计、活时间校正的 PI 波段计数率、临边圆拟合验证的盘内/离盘几何与精确 Poisson 显著性或 3σ 计数率上限；物理通量仍需 CALDB 响应矩阵谱拟合，滚转参考的日面坐标映射受限于 2014 年事件头缺少二进制表 WCS 关键字。AR11890 IRIS 方法复现（`analyze_iris_ar11890.py`）将正向控制扩展到第二个光谱事件（仍低于三次独立事件门槛）。尚未实现逐像素出版级 DEM、日冕自由能/NLFFF、人工确认的沿环能流或 MHD 能量闭合。预处理的作用是减少重复解码与运行时间，不是删除原始科学数据。

### 70 GB 上限内的证据包与批量派生层

`examples/coronal-evidence-70gb-v1.json` 当前对应 7 个独立活动区、13 个目标/背景窗口、长时段冷却、高时间分辨率爆发段和 304 Å 热非平衡诊断。主包为 61.490 GB；补充包包括 1.109 GB HMI SHARP CEA 矢量场、1.462 GB AR11899 IRIS/EIS 联合光谱，以及 1.453 GB EIS Level-1、AR11890/AR12222 IRIS 与四个 NuSTAR ObsID 定向包，总量为 65.514 GB。70 GB 是容量规划量级，不是必须填满的目标；继续增加同类 AIA 帧不会自动增加机制区分力。只有注册预测明确需要新的光谱、磁拓扑、模拟或独立事件时才补数。

```powershell
python scripts/fetch_coronal_starter.py `
  --plan `
  --spec examples/coronal-evidence-70gb-v1.json `
  --workers 12

python scripts/fetch_coronal_starter.py `
  --download `
  --spec examples/coronal-evidence-70gb-v1.json `
  --reuse-from data/dataset/coronal-starter-v1 `
  --workers 12 `
  --download-workers 4

$env:CORONAL_DATASET_ID = 'coronal-evidence-70gb-v1'
```

补充并登记 HMI SHARP 矢量磁场与事件匹配光谱：

```powershell
python scripts/fetch_hmi_sharp_vector.py `
  --manifest data/dataset/coronal-evidence-70gb-v1/manifest.json `
  --dataset-root data/dataset/coronal-evidence-70gb-v1 `
  --download --workers 12 --download-workers 4

python scripts/fetch_joint_spectroscopy.py `
  --root-manifest data/dataset/coronal-evidence-70gb-v1/manifest.json `
  --dataset-root data/dataset/coronal-evidence-70gb-v1
```

完整下载并校验后，批量构建工作缓存、事件级特征表、按活动区划分的数据 split 和压缩审计：

```powershell
python scripts/process_coronal_pack.py `
  --manifest data/dataset/coronal-evidence-70gb-v1/manifest.json `
  --dataset-root data/dataset/coronal-evidence-70gb-v1
```

脚本只有在所有原始资产均为 `verified` 且具有 SHA-256、HMI 元数据旁车和登记的数据补充包通过校验后才运行。输出位于 `derived/analysis-v4/`，其中 `processing_report.json` 给出实际缓存/原始数据比例，`event-features-v4.csv` 和 `.jsonl` 含事件级可审计特征。活动区/事件是独立统计单位；同一事件的不同帧和不同波段不得随机分散到训练集与验证集。

批处理会训练一个按活动区留一法评估的“事件窗口/背景窗口”辅助逻辑回归模型，用于质量检查和窗口排序。特征选择在训练折内部执行，并排除采集角色泄漏变量。当前 ROC AUC 为 0.774、平衡准确率为 0.786，按 7 个活动区配对的 64 种精确置换检验 `p=0.125`，因此报告保持 `pilot_only`、未校准，并固定写入 `mechanismEvidencePermitted=false`。它没有机制真值标签，不得创建 `support/contradict` 记录或被解释为机制概率。真正的机制分类器仍需独立专家裁决标签。

当前证据包足以完成比赛所需的可追溯闭环、同区背景反例、跨活动区留出、DEM/冷却/HMI 正交测量和方法复现；它仍不足以宣称某种日冕加热机制已被普遍证明。`support` 只表示某个非唯一观测预测相符，只有跨独立事件、绑定预测、含定量区间且被标为 `mechanism_discriminating` 的证据才可能通过 `supported` 门槛。

> **预处理版本标定声明（2026-08-29）**：该 `supported/strong` 结果产生于
> **v3 预处理**（无差分自转）。v4（wcs-roi-dem-v4）重建后事件目录更完整
> （4→12+ 事件/窗），部分 validation 窗的 fluence 预注册判据边缘性未过，
> `cohortReadiness` 回落 insufficient——v4/v5 下当前数据没有形成有效 supported，
> 候选如实为 `uncertain/needs_data`。**v3 结果保留为历史标定**；恢复路径是
> 按预注册规则补充独立/更长验证窗数据（判据不放宽、不事后挑选强尾部事件）。详见 `docs/闭环创新点总账.md` 附加-5/6。

当前提交基线是 [run-1788030664349-d02ffa8c](output/closure-complete-regression-r3-20260830/scientific-result.json)：`wcs-roi-dem-v5`、11 条假设全部 `uncertain / deferred_requires_data / insufficient`，`scientificStatus=needs_data`、`closureStatus=partial`。20 个任务中 16 个本地任务全部完成（含 AR11899 IRIS 与 5 个跨事件 holdout），4 个外部数据任务明确保留；失败任务、失败智能体和 error correction 均为 0，因此 `workflowClosure=complete`、`operationalClosure=complete`。归档包含 request、SSE、headers、代码补丁/状态清单以及 request/manifest/patch SHA。历史 Qwen v3 运行 `run-1787839551365-dec915cb` 仅用于证明旧标定下门禁路径可达，不代表当前 v5 数据支持某个过程或机制。详见 [最终说明](docs/competition-2b-final-backend-and-data.md)。

后端把“是否需要新增数据”下沉到验证任务：`readiness=executable_now` 表示现有数据和执行器可直接完成，`requires_data` 表示缺少明确的数据项，`external` 表示数据可能已有但本仓库没有执行器，`human_review` 表示需要专家复核。最终结果中的 `dataReadiness.requiresNewData` 只在存在 `requires_data` 任务时为真。不得因为结果为 `unknown` 就无条件增加数据；应先区分样本量不足、诊断缺失、效应小于可检测下限和预测本身不具区分力。

科学结论与流程完整度分开报告：`scientificStatus` 表示 `supported`、`mixed`、`needs_data` 等科学状态；`closureStatus` 表示证据和反证是否达到科学充分性；`workflowClosure` 检查每条假设是否已有本轮终局处置，以及是否还残留 `executable_now` 或 `unassessed` 任务；`operationalClosure` 独立检查失败智能体、失败任务、数据完整性错误和未清除的 error correction。新运行不再给假设输出貌似精确的 0–1 `confidence`，而使用 `not_assessed / insufficient / limited / moderate / strong / conflicted` 序数证据等级。定量结果中的 `confidenceLevel=0.95` 仅是该指标区间的覆盖水平，不是“假设为真的概率”。

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

`start-local.ps1 -WithHelix` 会在服务就绪后把当前 80 条去重且已核验的文献记录幂等写入 Helix；Helix 只提供检索语境，论文结论不会被直接提升为本地观测证据。在线文献检索默认开启，可用 `LITERATURE_ONLINE_ENABLED=false` 禁用；`OPENALEX_API_KEY` 和 `CROSSREF_MAILTO` 均为可选配置，不配置也能使用公开接口，但更容易受到限流。

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

本地已验证的 Qwen3.5-Plus 配置使用 `thinkingLevel=low`。部分兼容网关不接受 `medium`；若网关没有明确声明支持，不要假设把 `medium` 改高会提高科学可靠性，严格性由确定性证据门禁而不是思考档位保证。

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

该模式读取 `coronal-starter-v1`，执行 discovery、跨活动区 holdout、证据整理和综合流程，但不证明任何真实日冕加热机制。

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

### 提交用一键核心 Demo

完成依赖、环境和数据准备后，一条命令可启动服务、创建演示项目、提交 SSE 运行并导出请求、结果和元数据：

```powershell
corepack pnpm demo:scientific
```

默认使用不调用外部模型的 `local-grounded`。若本机已配置模型凭据和角色模型，可运行真实模型辅助版：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\run-scientific-demo.ps1 `
  -ExecutionMode model-assisted `
  -MaxRounds 2
```

结果默认写入 `output/scientific-demo/`。可直接检查的脱敏真实运行样例在 [outputs/ar11158-qwen-demo/README.md](outputs/ar11158-qwen-demo/README.md)。

已测资源基线：AMD Ryzen AI 7 H 350（8 核/16 线程）、31.1 GiB 内存、CPU 执行 FITS 处理，本地 GPU 未使用。全量帧版本首次生成完整缓存的两轮本地闭环约 82.4 秒，缓存完整后的同流程约 10.7 秒；新验证契约下的真实 Qwen 两轮回归约 12.8 分钟。远程模型耗时会随 API 负载变化，提交前应基于冻结代码重新运行 Qwen 基线。

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

- [docs/competition-2b-submission-audit.md](docs/competition-2b-submission-audit.md)：官方方向 2B P1—P9 逐项差距审计。
- [NEW_USER_COMMANDS.md](NEW_USER_COMMANDS.md)：全新 Windows 环境的完整执行命令。
- [SPEC.md](SPEC.md)：完整技术规格。
- [DESIGN.md](DESIGN.md)：系统设计。
- [AGENTS.md](AGENTS.md)：Agent 开发指南。
- [docs/web/](docs/web/)：Web 前端设计。

## License

尚未由项目权利人选定开源许可证。这是方向 2B 提交的阻塞项：公开仓库前必须由团队确认许可条款，在根目录添加 `LICENSE`，并同步本节。
