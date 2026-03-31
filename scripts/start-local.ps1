param(
  [string]$UpstreamBaseUrl = "",
  [int]$RequestTimeoutMs = 15000,
  [string]$ServerAddr = ":8080",
  [string]$DesktopRulesPath = "config/desktop_rules.json"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendScript = Join-Path $PSScriptRoot "start-backend.ps1"
$frontendScript = Join-Path $PSScriptRoot "start-frontend.ps1"

Start-Process powershell -ArgumentList @(
  "-ExecutionPolicy", "Bypass",
  "-File", $backendScript,
  "-UpstreamBaseUrl", $UpstreamBaseUrl,
  "-RequestTimeoutMs", "$RequestTimeoutMs",
  "-ServerAddr", $ServerAddr,
  "-DesktopRulesPath", $DesktopRulesPath
) -WorkingDirectory $repoRoot

Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList @(
  "-ExecutionPolicy", "Bypass",
  "-File", $frontendScript
) -WorkingDirectory $repoRoot

Write-Host "Backend starting on http://127.0.0.1:8080"
Write-Host "Frontend starting on http://127.0.0.1:5173"
if ($UpstreamBaseUrl) {
  Write-Host "Upstream base URL: $UpstreamBaseUrl"
}
