$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $repoRoot "releases"

if (-not (Test-Path $releaseRoot)) {
  throw "Release directory not found. Run scripts/publish-updates.ps1 first."
}

Push-Location $releaseRoot
try {
  python -m http.server 8787
}
finally {
  Pop-Location
}
