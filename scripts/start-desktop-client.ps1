$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$clientExe = Join-Path $repoRoot "frontend\desktop-app\src-tauri\target\release\desktop-app.exe"

if (-not (Test-Path $clientExe)) {
  throw "Desktop client not built yet. Run the Tauri build first."
}

Start-Process $clientExe
