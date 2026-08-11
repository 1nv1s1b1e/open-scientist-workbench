[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$ApiPort = 3002,

  [ValidateRange(1, 65535)]
  [int]$WebPort = 5173,

  [ValidateRange(10, 300)]
  [int]$TimeoutSeconds = 90,

  [switch]$WithHelix
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot '.runtime\local-services'
$StatePath = Join-Path $RuntimeDir 'processes.json'
$StartedAt = [DateTime]::UtcNow

function Import-LocalEnvironment {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $allowedKeys = @(
    'BASE_DIR',
    'HELIX_URL',
    'LOG_LEVEL',
    'CREDENTIAL_ENCRYPTION_KEY'
  )

  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      continue
    }

    $name = $Matches[1]
    if ($name -notin $allowedKeys) {
      continue
    }

    if ([Environment]::GetEnvironmentVariable($name, 'Process')) {
      continue
    }

    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Get-ListeningProcessId {
  param([int]$Port)

  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $listener) {
    return $null
  }
  return [int]$listener.OwningProcess
}

function Test-HttpEndpoint {
  param([string]$Uri)

  try {
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Wait-HttpEndpoint {
  param(
    [string]$Name,
    [string]$Uri,
    [int]$Timeout
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($Timeout)
  do {
    if (Test-HttpEndpoint -Uri $Uri) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "$Name did not become ready within $Timeout seconds: $Uri"
}

function Wait-TcpPort {
  param(
    [string]$Name,
    [int]$Port,
    [int]$Timeout
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($Timeout)
  do {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $connect = $client.ConnectAsync('127.0.0.1', $Port)
      if ($connect.Wait(1000) -and $client.Connected) {
        return
      }
    } catch {
      # Keep polling until the deadline.
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "$Name did not begin listening on port $Port within $Timeout seconds."
}

function Start-LocalHelix {
  param([int]$Timeout)

  if (-not $WithHelix) {
    return $false
  }

  $helixPort = 6969
  if ($env:HELIX_URL -and $env:HELIX_URL -match ':(\d+)(?:/|$)') {
    $helixPort = [int]$Matches[1]
  }

  if ($null -ne (Get-ListeningProcessId -Port $helixPort)) {
    Write-Host "HelixDB is already listening on port $helixPort."
    return $false
  }

  $helix = Join-Path $env:USERPROFILE '.local\bin\helix.exe'
  if (-not (Test-Path -LiteralPath $helix)) {
    throw "Helix CLI was not found at $helix. Start without -WithHelix or install Helix first."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'helix.toml'))) {
    throw 'helix.toml is missing. Initialize the local Helix project before using -WithHelix.'
  }

  Write-Host "Starting HelixDB on port $helixPort..."
  $helixProcess = Start-Process -FilePath $helix `
    -ArgumentList @('start', 'dev', '--quiet', '--port', [string]$helixPort) `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru
  if (-not $helixProcess.WaitForExit($Timeout * 1000)) {
    Stop-Process -Id $helixProcess.Id -Force -ErrorAction SilentlyContinue
    throw "HelixDB startup command timed out after $Timeout seconds. Check Docker Desktop before retrying."
  }
  if ($helixProcess.ExitCode -ne 0) {
    throw "HelixDB failed to start (exit code $($helixProcess.ExitCode))."
  }

  Wait-TcpPort -Name 'HelixDB' -Port $helixPort -Timeout $Timeout
  return $true
}

function Stop-StartedProcessTree {
  param(
    [System.Diagnostics.Process]$RootProcess,
    [Nullable[int]]$ListenerProcessId
  )

  if ($null -ne $RootProcess -and -not $RootProcess.HasExited) {
    & taskkill.exe /PID $RootProcess.Id /T /F 2>$null | Out-Null
  }

  if ($null -ne $ListenerProcessId) {
    Stop-Process -Id $ListenerProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Show-LogTail {
  param([string[]]$Paths)

  foreach ($path in $Paths) {
    if (Test-Path -LiteralPath $path) {
      Write-Warning "Last lines from $path"
      Get-Content -LiteralPath $path -Tail 25 -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Warning $_ }
    }
  }
}

Set-Location -LiteralPath $ProjectRoot
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
Import-LocalEnvironment -Path (Join-Path $ProjectRoot '.env')

$credentialKey = [Environment]::GetEnvironmentVariable('CREDENTIAL_ENCRYPTION_KEY', 'Process')
if (-not $credentialKey -or $credentialKey -eq '__SET_A_STABLE_LOCAL_SECRET__') {
  throw @'
CREDENTIAL_ENCRYPTION_KEY is not configured. Set the same stable local key that
was used to encrypt data/global.sqlite, either in .env or in the current shell:
  $env:CREDENTIAL_ENCRYPTION_KEY = '<your-existing-stable-key>'
Do not generate a new key when existing model credentials must remain readable.
'@
}

$corepack = (Get-Command corepack.cmd -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host 'Installing workspace dependencies...'
  & $corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm install failed with exit code $LASTEXITCODE."
  }
}

if (Test-Path -LiteralPath $StatePath) {
  if ((Test-HttpEndpoint -Uri "http://127.0.0.1:$ApiPort/api/health") -and
      (Test-HttpEndpoint -Uri "http://localhost:$WebPort")) {
    if ($WithHelix) {
      $existingState = Get-Content -LiteralPath $StatePath -Encoding UTF8 -Raw |
        ConvertFrom-Json
      if (Start-LocalHelix -Timeout $TimeoutSeconds) {
        $existingState.helixStartedByScript = $true
        $existingState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
      }
    }
    Write-Host 'Open-Scientist is already running.' -ForegroundColor Green
    Write-Host "Web:        http://localhost:$WebPort"
    Write-Host "API health: http://127.0.0.1:$ApiPort/api/health"
    exit 0
  }
  Remove-Item -LiteralPath $StatePath -Force
}

foreach ($port in @($ApiPort, $WebPort)) {
  $owner = Get-ListeningProcessId -Port $port
  if ($null -ne $owner) {
    throw "Port $port is already occupied by PID $owner. Stop that service or choose another port."
  }
}

$helixStartedByScript = Start-LocalHelix -Timeout $TimeoutSeconds

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$apiOutLog = Join-Path $RuntimeDir "api-$timestamp.out.log"
$apiErrLog = Join-Path $RuntimeDir "api-$timestamp.err.log"
$webOutLog = Join-Path $RuntimeDir "web-$timestamp.out.log"
$webErrLog = Join-Path $RuntimeDir "web-$timestamp.err.log"

$previousPort = $env:PORT
$previousApiBaseUrl = $env:API_BASE_URL
$previousPublicApiBaseUrl = $env:NEXT_PUBLIC_API_BASE_URL
$previousDebug = $env:DEBUG
$apiProcess = $null
$webProcess = $null
$apiListenerPid = $null
$webListenerPid = $null

try {
  $env:PORT = [string]$ApiPort
  $env:DEBUG = $null
  $apiProcess = Start-Process -FilePath $corepack `
    -ArgumentList @('pnpm', '--filter', '@open-scientist/api', 'dev') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $apiOutLog `
    -RedirectStandardError $apiErrLog `
    -PassThru

  Wait-HttpEndpoint -Name 'API' -Uri "http://127.0.0.1:$ApiPort/api/health" -Timeout $TimeoutSeconds
  $apiListenerPid = Get-ListeningProcessId -Port $ApiPort

  $env:API_BASE_URL = "http://127.0.0.1:$ApiPort"
  $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:$ApiPort"
  $webProcess = Start-Process -FilePath $corepack `
    -ArgumentList @('pnpm', '--filter', '@open-scientist/web', 'dev') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $webOutLog `
    -RedirectStandardError $webErrLog `
    -PassThru

  Wait-HttpEndpoint -Name 'Web' -Uri "http://localhost:$WebPort" -Timeout $TimeoutSeconds
  $webListenerPid = Get-ListeningProcessId -Port $WebPort

  $state = [ordered]@{
    startedAtUtc = $StartedAt.ToString('o')
    projectRoot = $ProjectRoot
    apiPort = $ApiPort
    webPort = $WebPort
    apiRootPid = $apiProcess.Id
    webRootPid = $webProcess.Id
    apiListenerPid = $apiListenerPid
    webListenerPid = $webListenerPid
    helixStartedByScript = $helixStartedByScript
    helixInstance = 'dev'
    apiOutLog = $apiOutLog
    apiErrLog = $apiErrLog
    webOutLog = $webOutLog
    webErrLog = $webErrLog
  }
  $state | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
} catch {
  Stop-StartedProcessTree -RootProcess $webProcess -ListenerProcessId $webListenerPid
  Stop-StartedProcessTree -RootProcess $apiProcess -ListenerProcessId $apiListenerPid
  if ($helixStartedByScript) {
    $helix = Join-Path $env:USERPROFILE '.local\bin\helix.exe'
    & $helix stop dev --quiet 2>$null | Out-Null
  }
  Show-LogTail -Paths @($apiErrLog, $apiOutLog, $webErrLog, $webOutLog)
  throw
} finally {
  $env:PORT = $previousPort
  $env:API_BASE_URL = $previousApiBaseUrl
  $env:NEXT_PUBLIC_API_BASE_URL = $previousPublicApiBaseUrl
  $env:DEBUG = $previousDebug
}

Write-Host ''
Write-Host 'Open-Scientist started successfully.' -ForegroundColor Green
Write-Host "Web:        http://localhost:$WebPort"
Write-Host "Demo:       http://localhost:$WebPort/projects/scientific-thinking-demo"
Write-Host "API health: http://127.0.0.1:$ApiPort/api/health"
Write-Host "State:      $StatePath"
Write-Host "Logs:       $RuntimeDir"
Write-Host ''
Write-Host 'Stop with:'
Write-Host '  corepack pnpm local:stop'
