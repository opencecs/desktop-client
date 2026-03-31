param(
  [string]$UpstreamBaseUrl = "https://www.opencecs.com/api/v1",
  [int]$RequestTimeoutMs = 15000,
  [string]$ServerAddr = ":8080",
  [string]$DesktopRulesPath = "config/desktop_rules.json"
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "start-local.ps1") -UpstreamBaseUrl $UpstreamBaseUrl -RequestTimeoutMs $RequestTimeoutMs -ServerAddr $ServerAddr -DesktopRulesPath $DesktopRulesPath
