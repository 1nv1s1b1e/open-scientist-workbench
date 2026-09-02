param(
  [int]$CatalogWorkers = 24,
  [int]$DownloadWorkers = 24
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = if ($env:PYTHON_EXECUTABLE) { $env:PYTHON_EXECUTABLE } else { 'python' }
$SpecPath = Join-Path $ProjectRoot 'examples/coronal-evidence-70gb-v1.json'
$StarterRoot = Join-Path $ProjectRoot 'data/dataset/coronal-starter-v1'
$EvidenceRoot = Join-Path $ProjectRoot 'data/dataset/coronal-evidence-70gb-v1'
$ManifestPath = Join-Path $EvidenceRoot 'manifest.json'

$env:OPEN_SCIENTIST_BYPASS_PROXY = '1'

& $Python (Join-Path $PSScriptRoot 'fetch_coronal_starter.py') `
  --download `
  --spec $SpecPath `
  --reuse-from $StarterRoot `
  --workers $CatalogWorkers `
  --download-workers $DownloadWorkers
if ($LASTEXITCODE -ne 0) {
  throw "Coronal evidence download failed with exit code $LASTEXITCODE"
}

& $Python (Join-Path $PSScriptRoot 'process_coronal_pack.py') `
  --manifest $ManifestPath `
  --dataset-root $EvidenceRoot
if ($LASTEXITCODE -ne 0) {
  throw "Coronal evidence processing failed with exit code $LASTEXITCODE"
}

Write-Output "Coronal evidence pack and derived working layer are complete: $EvidenceRoot"
