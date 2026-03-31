$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$baselineMsi = Join-Path $repoRoot "releases\archive\0.1.0\windows-x86_64\Device Control Center_0.1.0_x64_en-US.msi"
$latestManifest = Join-Path $repoRoot "releases\latest.json"
$releaseRoot = Join-Path $repoRoot "releases"

if (-not (Test-Path $baselineMsi)) {
  throw "Baseline MSI not found: $baselineMsi"
}

if (-not (Test-Path $latestManifest)) {
  throw "Update manifest not found: $latestManifest"
}

$manifest = Get-Content $latestManifest -Raw | ConvertFrom-Json

Write-Host ""
Write-Host "Local update rehearsal is ready." -ForegroundColor Green
Write-Host ""
Write-Host "1. Install baseline 0.1.0 MSI:" -ForegroundColor Cyan
Write-Host "   $baselineMsi"
Write-Host ""
Write-Host "2. Latest update manifest:" -ForegroundColor Cyan
Write-Host "   $latestManifest"
Write-Host "   version = $($manifest.version)"
Write-Host ""
Write-Host "3. Starting local update server at http://127.0.0.1:8787" -ForegroundColor Cyan
Write-Host "   Keep this window open while testing."
Write-Host ""
Write-Host "4. Open the installed 0.1.0 app and click '检查更新'." -ForegroundColor Cyan
Write-Host ""

Push-Location $releaseRoot
try {
  python -m http.server 8787
}
finally {
  Pop-Location
}
