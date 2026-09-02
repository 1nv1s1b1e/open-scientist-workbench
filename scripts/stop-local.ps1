[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot '.runtime\local-services'
$StatePath = Join-Path $RuntimeDir 'processes.json'

function Stop-ManagedProcessTree {
  param(
    [Nullable[int]]$RootProcessId,
    [Nullable[int]]$ListenerProcessId,
    [DateTime]$EarliestStartTime
  )

  if ($null -ne $RootProcessId) {
    $root = Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue
    $rootStartedAt = $null
    if ($null -ne $root) {
      try {
        $rootStartedAt = $root.StartTime.ToUniversalTime()
      }
      catch {
        $rootStartedAt = $null
      }
    }
    if ($null -ne $rootStartedAt -and $rootStartedAt -ge $EarliestStartTime) {
      & taskkill.exe /PID $RootProcessId /T /F 2>$null | Out-Null
    }
  }

  if ($null -ne $ListenerProcessId) {
    $listener = Get-Process -Id $ListenerProcessId -ErrorAction SilentlyContinue
    $listenerStartedAt = $null
    if ($null -ne $listener) {
      try {
        $listenerStartedAt = $listener.StartTime.ToUniversalTime()
      }
      catch {
        $listenerStartedAt = $null
      }
    }
    if ($null -ne $listenerStartedAt -and $listenerStartedAt -ge $EarliestStartTime) {
      Stop-Process -Id $ListenerProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not (Test-Path -LiteralPath $StatePath)) {
  Write-Host 'No managed Open-Scientist local session was found.'
  exit 0
}

$state = Get-Content -LiteralPath $StatePath -Encoding UTF8 -Raw | ConvertFrom-Json
$startedAt = [DateTime]::Parse($state.startedAtUtc).ToUniversalTime().AddSeconds(-5)

if ($state.webRootPid) {
  Stop-ManagedProcessTree `
    -RootProcessId $state.webRootPid `
    -ListenerProcessId $state.webListenerPid `
    -EarliestStartTime $startedAt
}
Stop-ManagedProcessTree `
  -RootProcessId $state.apiRootPid `
  -ListenerProcessId $state.apiListenerPid `
  -EarliestStartTime $startedAt

if ($state.helixStartedByScript) {
  $helix = Join-Path $env:USERPROFILE '.local\bin\helix.exe'
  if (Test-Path -LiteralPath $helix) {
    Set-Location -LiteralPath $ProjectRoot
    & $helix stop $state.helixInstance --quiet 2>$null | Out-Null
  }
}

Remove-Item -LiteralPath $StatePath -Force
Write-Host 'Open-Scientist local services stopped.' -ForegroundColor Green
Write-Host "Logs were kept in $RuntimeDir"
