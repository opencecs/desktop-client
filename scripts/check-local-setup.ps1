$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendEnv = Join-Path $repoRoot "backend\api\.env"
$backendExample = Join-Path $repoRoot "backend\api\.env.example"
$frontendPackage = Join-Path $repoRoot "frontend\desktop-app\package.json"
$tauriConfig = Join-Path $repoRoot "frontend\desktop-app\src-tauri\tauri.conf.json"

Write-Host "Local setup summary"
Write-Host "Repository: $repoRoot"
Write-Host ""

if (Test-Path $backendEnv) {
  Write-Host "Backend env: present"
} elseif (Test-Path $backendExample) {
  Write-Host "Backend env: missing, but .env.example exists"
} else {
  Write-Host "Backend env: missing"
}

if (Test-Path $frontendPackage) {
  $pkg = Get-Content $frontendPackage -Raw | ConvertFrom-Json
  Write-Host "Frontend version: $($pkg.version)"
}

if (Test-Path $tauriConfig) {
  $cfg = Get-Content $tauriConfig -Raw | ConvertFrom-Json
  Write-Host "Tauri updater endpoint: $($cfg.plugins.updater.endpoints[0])"
}

Write-Host ""
Write-Host "Use these commands:"
Write-Host "  Start: powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1"
Write-Host "  HTTP mode: powershell -ExecutionPolicy Bypass -File .\scripts\start-http-local.ps1 -UpstreamBaseUrl <real-upstream-url>"
Write-Host "  Current upstream default: https://www.opencecs.com/api/v1"
Write-Host "  Desktop classification: default is_desktop=true until upstream supplies the field"
