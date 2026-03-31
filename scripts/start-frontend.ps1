$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend\desktop-app"

Push-Location $frontendDir
try {
  if (-not (Test-Path "node_modules")) {
    npm install
  }

  npm run dev
}
finally {
  Pop-Location
}
