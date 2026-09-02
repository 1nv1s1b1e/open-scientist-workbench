$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot '.runtime\local-services'

# import allowed .env keys (mirrors start-local.ps1)
if (Test-Path (Join-Path $ProjectRoot '.env')) {
  foreach ($line in Get-Content (Join-Path $ProjectRoot '.env') -Encoding UTF8) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }
    $k = $Matches[1]; $v = $Matches[2].Trim().Trim('"')
    if ($k -in @('BASE_DIR','HELIX_URL','LOG_LEVEL','CREDENTIAL_ENCRYPTION_KEY','PYTHON_EXECUTABLE','CORONAL_DATASET_ID')) {
      [Environment]::SetEnvironmentVariable($k, $v, 'Process') | Out-Null
    }
  }
}

# 1) Helix if not listening
$helixPort = 6969
if ($env:HELIX_URL -match ':(\d+)(?:/|$)') { $helixPort = [int]$Matches[1] }
if ($null -eq (Get-NetTCPConnection -LocalPort $helixPort -State Listen -ErrorAction SilentlyContinue)) {
  $helix = Join-Path $env:USERPROFILE '.local\bin\helix.exe'
  Write-Output "starting helix on $helixPort"
  $hp = Start-Process -FilePath $helix -ArgumentList @('start','dev','--quiet','--port',"$helixPort") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
  if (-not $hp.WaitForExit(90000)) { Stop-Process -Id $hp.Id -Force -ErrorAction SilentlyContinue; throw 'helix start timed out' }
  if ($hp.ExitCode -ne 0) { throw "helix start failed exit $($hp.ExitCode)" }
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    if (Get-NetTCPConnection -LocalPort $helixPort -State Listen -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Seconds 2
  }
  Write-Output 'seeding literature corpus'
  & node (Join-Path $ProjectRoot 'scripts/seed-papers.ts')
  if ($LASTEXITCODE -ne 0) { throw 'seed failed' }
} else {
  Write-Output 'helix already listening'
}

# 2) API
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:PORT = '3002'
$env:DEBUG = $null
$api = Start-Process -FilePath 'corepack' -ArgumentList @('pnpm','--filter','@open-scientist/api','dev') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeDir "api-$ts.out.log") -RedirectStandardError (Join-Path $RuntimeDir "api-$ts.err.log") -PassThru
Write-Output "api root pid $($api.Id)"
$deadline = (Get-Date).AddSeconds(120)
$ok = $false
while ((Get-Date) -lt $deadline) {
  try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3002/api/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
  Start-Sleep -Seconds 3
}
if (-not $ok) { throw 'api health timeout' }
Write-Output 'api healthy'
