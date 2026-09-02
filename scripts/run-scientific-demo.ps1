[CmdletBinding()]
param(
  [ValidateSet('local-grounded', 'model-assisted')]
  [string]$ExecutionMode = 'local-grounded',

  [ValidateRange(1, 10)]
  [int]$MaxRounds = 2,

  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$ProjectId = 'submission-demo',

  [ValidateRange(1, 65535)]
  [int]$ApiPort = 3002,

  [ValidateRange(1, 65535)]
  [int]$WebPort = 5173,

  [ValidateRange(60, 7200)]
  [int]$RequestTimeoutSeconds = 1800,

  [string]$OutputDirectory = 'output/scientific-demo',

  # Custom phenomenon request (JSON). Defaults to the AR11158 template.
  [string]$RequestTemplate = '',

  # API-only demo: start the API without the Next.js workbench.
  [switch]$SkipWeb,

  [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ApiBase = "http://127.0.0.1:$ApiPort"
$RequestTemplateArg = $RequestTemplate
$RequestTemplate = if ([string]::IsNullOrWhiteSpace($RequestTemplateArg)) {
  Join-Path $ProjectRoot 'examples/ar11158-scientific-demo.request.json'
} else {
  if ([IO.Path]::IsPathRooted($RequestTemplateArg)) { $RequestTemplateArg } else { Join-Path $ProjectRoot $RequestTemplateArg }
}

# Resolve environment defaults from the project .env, mirroring how
# start-local.ps1 imports them into the API process. Without this the demo
# process would not see PYTHON_EXECUTABLE / CORONAL_DATASET_ID configured in
# .env and would fail the dataset-consistency check against a running API.
function Get-LocalEnvValue {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
  $envFilePath = Join-Path $ProjectRoot '.env'
  if (Test-Path -LiteralPath $envFilePath) {
    $line = Get-Content -LiteralPath $envFilePath -Encoding UTF8 |
      Where-Object { $_ -match '^\s*' + $Name + '\s*=' } |
      Select-Object -Last 1
    if ($line) {
      $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
  }
  return $null
}

$CoronalDatasetId = Get-LocalEnvValue 'CORONAL_DATASET_ID'
if ([string]::IsNullOrWhiteSpace($CoronalDatasetId)) {
  $CoronalDatasetId = 'coronal-starter-v1'
}
$ManifestPath = Join-Path $ProjectRoot "data/dataset/$CoronalDatasetId/manifest.json"
$RuntimeDirectory = Join-Path $ProjectRoot '.runtime/submission-demo'
$ResolvedOutputDirectory = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  [IO.Path]::GetFullPath((Join-Path $ProjectRoot $OutputDirectory))
}

function Get-ApiHealth {
  try {
    return Invoke-RestMethod -Uri "$ApiBase/api/health" -TimeoutSec 5
  } catch {
    return $null
  }
}

function Test-ApiHealth {
  $response = Get-ApiHealth
  return $null -ne $response -and $response.status -eq 'ok'
}

function Write-JsonUtf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Value,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    [ValidateRange(2, 100)]
    [int]$Depth = 20
  )

  $json = $Value | ConvertTo-Json -Depth $Depth
  [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Missing dataset manifest: $ManifestPath. Fetch or prepare dataset '$CoronalDatasetId' first."
}
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  throw 'curl.exe is required to capture the SSE result stream.'
}

# Preflight the Python interpreter exactly the way the API resolves it
# (PYTHON_EXECUTABLE environment, then the project .env, then `python` on
# PATH) and verify the scientific stack imports before spending a run.
# A machine whose PATH shadows `python` with an unrelated interpreter
# (e.g. the one bundled with Inkscape) previously surfaced this only later
# as per-agent "执行失败" limitations after the run had already started.
$pythonExecutable = Get-LocalEnvValue 'PYTHON_EXECUTABLE'
if ([string]::IsNullOrWhiteSpace($pythonExecutable)) {
  $pythonExecutable = 'python'
}
$pythonCheckOutput = & $pythonExecutable -c "import numpy, astropy, matplotlib, sunpy; print('python-preflight-ok')" 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($pythonCheckOutput -match 'python-preflight-ok')) {
  throw @"
Python scientific stack preflight failed for '$pythonExecutable'.
The deterministic diagnostics require numpy, astropy, matplotlib and sunpy
(see requirements.txt). Install the locked dependencies or point
PYTHON_EXECUTABLE in .env at a suitable interpreter, then restart the
local services:
  PYTHON_EXECUTABLE=C:\path\to\python.exe
Interpreter output:
$pythonCheckOutput
"@
}
Write-Host "Python preflight OK: $pythonExecutable"

if (-not (Test-ApiHealth)) {
  if ($SkipStart) {
    throw "API is not healthy at $ApiBase and -SkipStart was supplied."
  }
  $startArgs = @{ ApiPort = $ApiPort; WebPort = $WebPort }
  if ($SkipWeb) { $startArgs.NoWeb = $true }
  & (Join-Path $PSScriptRoot 'start-local.ps1') @startArgs
}
if (-not (Test-ApiHealth)) {
  throw "API did not become healthy at $ApiBase."
}
$apiHealth = Get-ApiHealth
if ($apiHealth.coronalDatasetId -ne $CoronalDatasetId) {
  throw "API dataset mismatch: requested '$CoronalDatasetId', but the running API serves '$($apiHealth.coronalDatasetId)'. Stop the local services, set CORONAL_DATASET_ID, and restart before running the demo."
}

try {
  Invoke-RestMethod -Uri "$ApiBase/api/projects/$ProjectId" -TimeoutSec 10 | Out-Null
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -ne 404) { throw }
  $projectBody = @{ name = $ProjectId } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$ApiBase/api/projects" -ContentType 'application/json' -Body $projectBody -TimeoutSec 20 | Out-Null
}

New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $ResolvedOutputDirectory -Force | Out-Null
$request = Get-Content -Raw -LiteralPath $RequestTemplate -Encoding UTF8 | ConvertFrom-Json
$request.executionMode = $ExecutionMode
$request.maxRounds = $MaxRounds
$requestPath = Join-Path $RuntimeDirectory 'request.json'
$headersPath = Join-Path $RuntimeDirectory 'response.headers.txt'
$ssePath = Join-Path $RuntimeDirectory 'response.sse'
Write-JsonUtf8NoBom -Value $request -Path $requestPath -Depth 20

Write-Host "Running $ExecutionMode scientific demo (maxRounds=$MaxRounds)..."
& curl.exe `
  --no-buffer `
  --max-time $RequestTimeoutSeconds `
  -sS `
  -D $headersPath `
  -H 'Content-Type: application/json' `
  --data-binary "@$requestPath" `
  "$ApiBase/api/projects/$ProjectId/runs" `
  -o $ssePath
$initialCurlExit = $LASTEXITCODE
if ($initialCurlExit -ne 0) {
  # Dev servers can restart after a watched-file change or recover after a
  # transient process failure. The API persists LangGraph checkpoints and the
  # run id in the response headers, so resume that exact run instead of
  # silently starting a new scientific experiment.
  $runHeader = Get-Content -LiteralPath $headersPath -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^x-workflow-run-id:\s*(\S+)' } |
    Select-Object -Last 1
  $recoveryRunId = if ($runHeader -and $runHeader -match '^x-workflow-run-id:\s*(\S+)') {
    $Matches[1]
  } else { $null }
  if (-not $recoveryRunId) {
    throw "Scientific demo request failed with curl exit code $initialCurlExit and no workflow run id was returned."
  }
  Write-Warning "Scientific SSE disconnected (curl $initialCurlExit); waiting to resume run $recoveryRunId."
  $recoveryDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not (Test-ApiHealth) -and [DateTime]::UtcNow -lt $recoveryDeadline) {
    Start-Sleep -Seconds 2
  }
  if (-not (Test-ApiHealth)) {
    throw "API did not recover in time to resume scientific run $recoveryRunId."
  }
  $recoverySsePath = Join-Path $RuntimeDirectory 'response.recovery.sse'
  $resumeBodyPath = Join-Path $RuntimeDirectory 'resume-request.json'
  Write-JsonUtf8NoBom -Value @{ scientific = $true } -Path $resumeBodyPath -Depth 4
  & curl.exe `
    --fail-with-body `
    --no-buffer `
    --max-time $RequestTimeoutSeconds `
    -sS `
    -H 'Content-Type: application/json' `
    --data-binary "@$resumeBodyPath" `
    "$ApiBase/api/projects/$ProjectId/runs/$recoveryRunId/resume" `
    -o $recoverySsePath
  $recoveryExit = $LASTEXITCODE
  if ($recoveryExit -ne 0) {
    # A 409 means the workflow is already active (or completed) in the
    # recovered process. Reconnect to its persisted/replayable stream.
    & curl.exe `
      --fail-with-body `
      --no-buffer `
      --max-time $RequestTimeoutSeconds `
      -sS `
      "$ApiBase/api/projects/$ProjectId/runs/$recoveryRunId/stream" `
      -o $recoverySsePath
    $recoveryExit = $LASTEXITCODE
  }
  if ($recoveryExit -ne 0 -or -not (Test-Path -LiteralPath $recoverySsePath)) {
    throw "Scientific run $recoveryRunId could not be resumed or reconnected (curl $recoveryExit)."
  }
  [IO.File]::AppendAllText(
    $ssePath,
    ([Environment]::NewLine + [IO.File]::ReadAllText($recoverySsePath, (New-Object Text.UTF8Encoding($false)))),
    (New-Object Text.UTF8Encoding($false))
  )
}

$completionLine = Get-Content -LiteralPath $ssePath -Encoding UTF8 |
  Where-Object { $_ -like 'data: *scientific.loop-complete*' } |
  Select-Object -Last 1
if (-not $completionLine) {
  throw "The stream ended without scientific.loop-complete. Inspect $ssePath."
}
$completion = $completionLine.Substring(6) | ConvertFrom-Json
$resultPath = Join-Path $ResolvedOutputDirectory 'scientific-result.json'
$requestOutputPath = Join-Path $ResolvedOutputDirectory 'request.json'
Write-JsonUtf8NoBom -Value $completion.result -Path $resultPath -Depth 100
Write-JsonUtf8NoBom -Value $request -Path $requestOutputPath -Depth 20

# P1-10: independent replay archive — full SSE, response headers, request and
# the dirty-diff patch of the code state that produced this result.
Copy-Item -LiteralPath $ssePath -Destination (Join-Path $ResolvedOutputDirectory 'response.sse') -Force
if (Test-Path -LiteralPath $headersPath) {
  Copy-Item -LiteralPath $headersPath -Destination (Join-Path $ResolvedOutputDirectory 'response.headers.txt') -Force
}
$patchPath = Join-Path $ResolvedOutputDirectory 'code-state.patch'
$statusPath = Join-Path $ResolvedOutputDirectory 'code-state.status.txt'
try {
  $utf8NoBom = New-Object Text.UTF8Encoding($false)
  $trackedPatch = @(& git -c core.safecrlf=false -C $ProjectRoot diff --binary HEAD -- 2>$null)
  [IO.File]::WriteAllLines($patchPath, [string[]]$trackedPatch, $utf8NoBom)

  # `git diff HEAD` omits untracked source files. Several scientific-loop
  # modules may legitimately be new during a dirty-worktree demo, so append
  # new-file patches for the executable source/config roots as well. Runtime
  # data, node_modules and output archives remain excluded.
  $untrackedSourceFiles = @(
    & git -C $ProjectRoot ls-files --others --exclude-standard -- `
      apps packages scripts examples sources `
      package.json pnpm-lock.yaml pnpm-workspace.yaml requirements.txt `
      tsconfig.base.json vite.config.ts .env.example 2>$null
  )
  foreach ($relativePath in $untrackedSourceFiles) {
    $newFilePatch = @(
      & git -c core.safecrlf=false -C $ProjectRoot diff --binary --no-index -- /dev/null $relativePath 2>$null
    )
    if ($newFilePatch.Count -gt 0) {
      [IO.File]::AppendAllText(
        $patchPath,
        ([Environment]::NewLine + ($newFilePatch -join [Environment]::NewLine) + [Environment]::NewLine),
        $utf8NoBom
      )
    }
  }
  $statusLines = @(& git -C $ProjectRoot status --porcelain=v1 2>$null)
  [IO.File]::WriteAllLines($statusPath, [string[]]$statusLines, $utf8NoBom)
} catch {
  Write-Warning "git diff patch archive skipped: $($_.Exception.Message)"
}

# P1-10: archive provenance — code state, dataset manifest SHA, request SHA.
$gitCommit = 'unknown'
try {
  $gitCommit = (git -C $ProjectRoot rev-parse HEAD) 2>$null
  if (-not $gitCommit) { $gitCommit = 'unknown' }
} catch { $gitCommit = 'unknown' }
$dirtyCount = 'unknown'
try {
  $dirtyCount = @(git -C $ProjectRoot status --porcelain).Count
} catch { $dirtyCount = 'unknown' }
$datasetManifestSha = (Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLower()
$requestSha = (Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash.ToLower()
$codeStatePatchSha = if (Test-Path -LiteralPath $patchPath) {
  (Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash.ToLower()
} else { 'unavailable' }
$preprocessingVersions = @(
  Get-Content -LiteralPath $ssePath -Encoding UTF8 |
    Where-Object { $_ -like 'data: *scientific.processing-result*' } |
    ForEach-Object {
      try {
        $event = $_.Substring(6) | ConvertFrom-Json
        if ($event.preprocessing.version) { [string]$event.preprocessing.version }
      } catch { }
    } |
    Sort-Object -Unique
)

$metadata = [ordered]@{
  runId = $completion.result.runId
  datasetId = $CoronalDatasetId
  datasetManifestSha256 = $datasetManifestSha
  requestSha256 = $requestSha
  requestTemplate = $RequestTemplate
  sseStreamPath = 'response.sse'
  responseHeadersPath = 'response.headers.txt'
  codeStatePatchPath = 'code-state.patch'
  codeStatePatchSha256 = $codeStatePatchSha
  codeStateStatusPath = 'code-state.status.txt'
  codeCommit = $gitCommit
  codeDirtyFileCount = $dirtyCount
  preprocessingVersions = $preprocessingVersions
  executionMode = $ExecutionMode
  maxRounds = $MaxRounds
  status = $completion.result.status
  scientificStatus = $completion.result.scientificStatus
  closureStatus = $completion.result.closureStatus
  workflowClosureStatus = $completion.result.workflowClosure.status
  operationalClosureStatus = $completion.result.operationalClosure.status
  terminationReason = $completion.result.terminationReason
  hypothesisCount = @($completion.result.hypotheses).Count
  evidenceCount = @($completion.result.evidence).Count
  validationTaskCount = @($completion.result.validationTasks).Count
  exportedAt = [DateTime]::UtcNow.ToString('o')
}
Write-JsonUtf8NoBom `
  -Value $metadata `
  -Path (Join-Path $ResolvedOutputDirectory 'run-metadata.json') `
  -Depth 10

Write-Host "Run ID:      $($completion.result.runId)"
Write-Host "Science:     $($completion.result.scientificStatus)"
Write-Host "Result JSON: $resultPath"
