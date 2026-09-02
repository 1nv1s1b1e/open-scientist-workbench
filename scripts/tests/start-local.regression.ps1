# PowerShell startup regression test (P0-4): syntax + parameter surface +
# NoWeb semantics for the startup/stop/demo scripts. Runs under PS 5.1+.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failures = New-Object System.Collections.Generic.List[string]

foreach ($script in @('start-local.ps1', 'stop-local.ps1', 'run-scientific-demo.ps1')) {
    $path = Join-Path $ProjectRoot ("scripts/" + $script)
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        $failures.Add($script + ": " + $errors.Count.ToString() + " parse error(s): " + $errors[0].Message)
    }
}

$startText = Get-Content (Join-Path $ProjectRoot 'scripts/start-local.ps1') -Raw
foreach ($expected in @('[switch]$NoWeb', '[int]$WebPort = 5173', '[switch]$WithHelix')) {
    if (-not $startText.Contains($expected)) {
        $failures.Add('start-local.ps1 missing ' + $expected)
    }
}
$demoText = Get-Content (Join-Path $ProjectRoot 'scripts/run-scientific-demo.ps1') -Raw
foreach ($expected in @('[switch]$SkipWeb', '[switch]$SkipStart', '[string]$RequestTemplate')) {
    if (-not $demoText.Contains($expected)) {
        $failures.Add('run-scientific-demo.ps1 missing ' + $expected)
    }
}
if ($startText.Contains('foreach ($port in @($ApiPort, $WebPort))')) {
    $failures.Add('start-local.ps1 still checks WebPort occupancy unconditionally (NoWeb not honored)')
}
if (-not $startText.Contains("'NoWeb requested")) {
    $failures.Add('start-local.ps1 does not skip the Next.js workbench under NoWeb')
}
if (-not $startText.Contains("'-p'")) {
    $failures.Add('start-local.ps1 does not pass -p WebPort to next dev (WebPort ignored bug)')
}
if (-not $demoText.Contains('$startArgs.NoWeb = $true')) {
    $failures.Add('run-scientific-demo.ps1 does not forward SkipWeb to start-local')
}
foreach ($expected in @(
    "'response.sse'",
    "'response.headers.txt'",
    "'code-state.patch'",
    "'code-state.status.txt'",
    'codeStatePatchSha256',
    'operationalClosureStatus',
    'ls-files --others --exclude-standard',
    'x-workflow-run-id',
    '/resume',
    '/stream'
)) {
    if (-not $demoText.Contains($expected)) {
        $failures.Add('run-scientific-demo.ps1 missing replay archive element ' + $expected)
    }
}
$stopText = Get-Content (Join-Path $ProjectRoot 'scripts/stop-local.ps1') -Raw
if (-not $stopText.Contains('if ($state.webRootPid)')) {
    $failures.Add('stop-local.ps1 does not tolerate a missing webRootPid (API-only runs)')
}

if ($failures.Count -gt 0) {
    Write-Host ("FAIL (" + $failures.Count + "):")
    foreach ($item in $failures) { Write-Host ("  - " + $item) }
    exit 1
}
Write-Host 'PowerShell startup regression: PASS'
exit 0
