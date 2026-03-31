$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend\desktop-app"
$packageJson = Get-Content (Join-Path $frontendDir "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$bundleDir = Join-Path $frontendDir "src-tauri\target\release\bundle\msi"
$releaseRoot = Join-Path $repoRoot "releases"
$platformDir = Join-Path $releaseRoot "windows-x86_64"

if (-not (Test-Path $bundleDir)) {
  throw "MSI bundle directory not found. Run scripts/build-desktop-msi.ps1 first."
}

$msi = Get-ChildItem $bundleDir -Filter *.msi | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$sig = Get-ChildItem $bundleDir -Filter *.sig | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $msi) {
  throw "No MSI artifact found in $bundleDir"
}

if (-not $sig) {
  throw "No updater signature found in $bundleDir"
}

New-Item -ItemType Directory -Force -Path $platformDir | Out-Null
Copy-Item $msi.FullName (Join-Path $platformDir $msi.Name) -Force
Copy-Item $sig.FullName (Join-Path $platformDir $sig.Name) -Force

$signature = (Get-Content $sig.FullName -Raw).Trim()
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$manifest = [ordered]@{
  version = $version
  notes = "Device Control Center desktop release $version"
  pub_date = $now
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url = "http://127.0.0.1:8787/windows-x86_64/$($msi.Name)"
    }
  }
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$manifestPath = Join-Path $releaseRoot "latest.json"
$manifestJson = $manifest | ConvertTo-Json -Depth 8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
Write-Host "Published update manifest to $releaseRoot\latest.json"
