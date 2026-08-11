# 新用户完整执行命令（Windows）

本文面向一台尚未安装 Git、Node.js、pnpm 和 Python 的 Windows 10/11 电脑。按顺序执行即可启动 `local-grounded` pipeline；该模式不需要模型 API key。

命令默认使用 Windows PowerShell 和仓库内置数据目录。下载的 SDO 数据约为 7.374 GB，请预留至少 10 GB 可用空间。

## 1. 安装基础软件

打开 PowerShell，执行：

```powershell
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS -e --source winget --accept-package-agreements --accept-source-agreements
winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
```

安装结束后关闭 PowerShell，再打开一个新的 PowerShell 窗口，使 `PATH` 更新生效。

确认安装结果：

```powershell
git --version
node --version
npm.cmd --version
python --version
curl.exe --version
```

安装 Corepack。仓库通过 Corepack 使用锁定的 pnpm 11.15.1：

```powershell
npm.cmd install --global corepack@latest
corepack.cmd --version
corepack.cmd pnpm --version
```

如果电脑没有 `winget`，请先从 Microsoft Store 安装“应用安装程序”，再重新执行本节命令。

## 2. 下载代码

选择一个工作目录，然后 clone 团队分支：

```powershell
New-Item -ItemType Directory -Force -Path C:\open-scientist-work | Out-Null
Set-Location C:\open-scientist-work
git clone --branch feature/ymy-branch --single-branch https://github.com/asckaya/open-scientist.git
Set-Location .\open-scientist
git branch --show-current
```

最后一条命令应输出：

```text
feature/ymy-branch
```

有私有仓库权限的团队成员也可以改用：

```powershell
Set-Location C:\open-scientist-work
git clone https://github.com/1nv1s1b1e/open-scientist-workbench.git
Set-Location .\open-scientist-workbench
git branch --show-current
```

私有仓库 clone 要求当前电脑已经配置 GitHub 身份验证。两种 clone 方式任选一种，不要在同一目录重复执行。

## 3. 安装 Node.js 依赖

在仓库根目录执行：

```powershell
corepack.cmd pnpm install --frozen-lockfile
```

## 4. 建立 Python 环境

创建虚拟环境并安装 FITS 数据处理依赖：

```powershell
python -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install numpy scipy astropy
$env:PYTHON_EXECUTABLE = (Resolve-Path .\.venv\Scripts\python.exe).Path
python -c "import numpy, scipy, astropy; print('Python dependencies: OK')"
```

每次重新打开 PowerShell 后，先进入仓库并重新激活环境：

```powershell
Set-Location C:\open-scientist-work\open-scientist
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
$env:PYTHON_EXECUTABLE = (Resolve-Path .\.venv\Scripts\python.exe).Path
```

如果 clone 的是私有仓库，将最后一组命令中的目录改为：

```powershell
Set-Location C:\open-scientist-work\open-scientist-workbench
```

## 5. 创建本地配置

复制模板，并生成一个只在本机使用的稳定加密密钥：

```powershell
Copy-Item .env.example .env

$keyBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($keyBytes)
$rng.Dispose()
$credentialKey = [Convert]::ToBase64String($keyBytes)

$envPath = (Resolve-Path .\.env).Path
$envText = [System.IO.File]::ReadAllText($envPath)
$envText = $envText.Replace('__SET_A_STABLE_LOCAL_SECRET__', $credentialKey)
[System.IO.File]::WriteAllText(
  $envPath,
  $envText,
  (New-Object System.Text.UTF8Encoding($false))
)
```

确认占位符已经消失，但不要输出或分享真实密钥：

```powershell
if (Select-String -Path .env -Pattern '__SET_A_STABLE_LOCAL_SECRET__' -Quiet) {
  throw 'CREDENTIAL_ENCRYPTION_KEY was not replaced.'
}
Write-Host 'Local .env: OK'
```

`.env`、数据库和模型凭据只能留在本机，不要提交到 Git。

## 6. 下载约 7.374 GB 数据

先查询下载计划和预计大小：

```powershell
python scripts/fetch_coronal_starter.py --plan
```

下载、计算 SHA-256 并写入 manifest：

```powershell
python scripts/fetch_coronal_starter.py --download --download-workers 4
```

网络中断后可以重新执行同一条命令。脚本会验证并跳过已经完整下载的文件。

确认数据位置：

```powershell
$datasetRoot = Resolve-Path .\data\dataset\coronal-starter-v1
Test-Path (Join-Path $datasetRoot 'manifest.json')
(Get-ChildItem -Path (Join-Path $datasetRoot 'raw') -Filter *.fits -File -Recurse).Count
```

正常情况下，第一条检查输出 `True`，FITS 文件数量为 `704`。

### 可选：把数据放在其他磁盘

如果 C 盘空间不足，请跳过上面的默认下载命令，改用以下命令：

```powershell
New-Item -ItemType Directory -Force -Path D:\open-scientist-data | Out-Null
$env:DATASET_DIR = 'D:\open-scientist-data'
python scripts/fetch_coronal_starter.py `
  --download `
  --download-workers 4 `
  --output (Join-Path $env:DATASET_DIR 'coronal-starter-v1')
```

以后每次启动服务前，都要在当前 PowerShell 窗口执行：

```powershell
$env:DATASET_DIR = 'D:\open-scientist-data'
```

## 7. 在启动前做数据处理测试

使用一个有界观测案例运行 discovery：

```powershell
$datasetParent = if ($env:DATASET_DIR) { $env:DATASET_DIR } else { '.\data\dataset' }
$coronalDataset = Join-Path $datasetParent 'coronal-starter-v1'

python scripts/analyze_coronal_window.py `
  --manifest (Join-Path $coronalDataset 'manifest.json') `
  --dataset-root $coronalDataset `
  --case-id ar11158-window-20110215 `
  --output-dir .\output\coronal-smoke `
  --mode discovery
```

确认测试产物：

```powershell
Get-ChildItem .\output\coronal-smoke -Recurse
```

## 8. 启动 API 和 Web

确保当前 PowerShell 仍处于仓库根目录，且 `.venv` 已激活：

```powershell
corepack.cmd pnpm local:start
```

默认地址：

```text
Web:        http://localhost:5173
API health: http://127.0.0.1:3002/api/health
```

检查 API 并打开 Web：

```powershell
Invoke-RestMethod http://127.0.0.1:3002/api/health
Start-Process http://localhost:5173
```

## 9. 运行无需模型的 pipeline

在 Web 页面中执行以下操作：

1. 创建项目。
2. 输入太阳活动现象、活动区或观测窗口，以及研究问题。
3. 选择 `local-grounded`。
4. 启动 run。
5. 检查假设、证据、验证队列和最终综合结果。

`local-grounded` 不需要配置 API key。它用于验证数据、服务和科学流程能否运行，不代表已经证明某种日冕加热机制。

运行记录位于：

```powershell
Get-ChildItem .\data\projects -Recurse -Filter science-loop.jsonl
```

## 10. 可选：配置模型辅助模式

只有运行 `model-assisted` 时才执行本节。打开 Web 的 Settings 页面，然后添加 credential 和角色模型配置：

```powershell
Start-Process http://localhost:5173/settings
```

OpenAI-compatible 或 Qwen 网关通常填写：

```text
provider:      openai
model:         <网关提供的模型名>
baseURL:       https://<gateway-host>/v1
apiMode:       chat
credentialId: <自定义 credential ID>
```

需要为 `sisyphus`、`librarian`、`looker`、`explore`、`oracle` 和 `prometheus` 配置模型，或提供它们可以回退使用的默认模型配置。API key 只在 Settings 中保存，不要写入本文、源码或提交记录。

## 11. 运行项目检查

类型检查：

```powershell
corepack.cmd pnpm exec vp run -r typecheck
```

测试：

```powershell
corepack.cmd pnpm exec vp test run
```

## 12. 停止服务

```powershell
corepack.cmd pnpm local:stop
```

确认端口已经停止监听：

```powershell
Test-NetConnection 127.0.0.1 -Port 3002
Test-NetConnection 127.0.0.1 -Port 5173
```

停止后，两个结果中的 `TcpTestSucceeded` 应为 `False`。

## 13. 下次启动所需命令

默认 clone 路径和默认数据目录：

```powershell
Set-Location C:\open-scientist-work\open-scientist
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
$env:PYTHON_EXECUTABLE = (Resolve-Path .\.venv\Scripts\python.exe).Path
corepack.cmd pnpm local:start
Start-Process http://localhost:5173
```

数据位于 D 盘时，在启动命令前增加：

```powershell
$env:DATASET_DIR = 'D:\open-scientist-data'
```

停止命令：

```powershell
corepack.cmd pnpm local:stop
```
