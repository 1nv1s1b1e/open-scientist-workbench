$env:API_BASE_URL = "http://127.0.0.1:3002"
$env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:3002"
$corepack = (Get-Command corepack.cmd -ErrorAction SilentlyContinue).Source
if (-not $corepack) { $corepack = (Get-Command corepack -ErrorAction SilentlyContinue).Source }
$p = Start-Process -FilePath $corepack -ArgumentList @('pnpm','--filter','@open-scientist/web','start') -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -WindowStyle Hidden -RedirectStandardOutput ".runtime\local-services\web-prod.out.log" -RedirectStandardError ".runtime\local-services\web-prod.err.log" -PassThru
Write-Output "started root pid $($p.Id)"
