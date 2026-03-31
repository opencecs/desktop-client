param(
  [string]$UpstreamBaseUrl = "",
  [int]$RequestTimeoutMs = 15000,
  [string]$ServerAddr = ":8080",
  [string]$DesktopRulesPath = "config/desktop_rules.json"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend\api"

Push-Location $backendDir
try {
  # 先关闭占用 8080 端口的旧进程
  $port = if ($ServerAddr -match ':(\d+)$') { [int]$Matches[1] } else { 8080 }
  $existing = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($existing) {
    $pids = $existing.OwningProcess | Sort-Object -Unique
    Write-Host "关闭占用端口 $port 的进程: $($pids -join ', ')" -ForegroundColor Yellow
    Get-Process -Id $pids -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }

  if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
  }

  $effectiveBaseUrl = if ($UpstreamBaseUrl) { $UpstreamBaseUrl } else { $env:UPSTREAM_BASE_URL }
  if ([string]::IsNullOrWhiteSpace($effectiveBaseUrl)) {
    $effectiveBaseUrl = "https://www.opencecs.com/api/v1"
  }

  $env:SERVER_ADDR = $ServerAddr
  $env:UPSTREAM_BASE_URL = $effectiveBaseUrl
  $env:REQUEST_TIMEOUT_MS = "$RequestTimeoutMs"
  $env:DESKTOP_RULES_PATH = $DesktopRulesPath
  $env:GOCACHE = Join-Path $backendDir ".cache\go-build"
  $env:GOMODCACHE = Join-Path $backendDir ".cache\gomod"

  Write-Host "Upstream base URL: $effectiveBaseUrl"
  Write-Host "Backend address: $ServerAddr"

  go run ./cmd/server
}
finally {
  Pop-Location
}
