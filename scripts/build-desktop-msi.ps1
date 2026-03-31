$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend\desktop-app"
$backendDir = Join-Path $repoRoot "backend\api"
$backendBinDir = Join-Path $backendDir "bin"
$targetTriple = "x86_64-pc-windows-msvc"
$backendSidecarBase = Join-Path $backendBinDir "device-control-backend"
$backendSidecarExe = "$backendSidecarBase-$targetTriple.exe"
$devCmd = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\LaunchDevCmd.bat"
$wixDir = Join-Path $repoRoot "tools\wix314"
$tauriToolsDir = Join-Path $frontendDir "src-tauri\target\.tauri\WixTools314"
$privateKeyPath = Join-Path $repoRoot ".secrets\tauri\updater.key"
$passwordPath = Join-Path $repoRoot ".secrets\tauri\updater-password.txt"
$bundleDir = Join-Path $frontendDir "src-tauri\target\release\bundle\msi"

if (-not (Test-Path $privateKeyPath)) {
  throw "Updater private key not found: $privateKeyPath"
}

if (-not (Test-Path $passwordPath)) {
  throw "Updater private key password file not found: $passwordPath"
}

if (-not (Test-Path $wixDir)) {
  throw "WiX toolchain not found: $wixDir"
}

New-Item -ItemType Directory -Force -Path $backendBinDir | Out-Null
Push-Location $backendDir
try {
  $env:GOCACHE = Join-Path $backendDir ".cache\\go-build"
  $env:GOMODCACHE = Join-Path $backendDir ".cache\\gomod"
  go build -o $backendSidecarExe ./cmd/server
  if ($LASTEXITCODE -ne 0) {
    throw "Go backend sidecar build failed"
  }
}
finally {
  Pop-Location
}

$password = (Get-Content $passwordPath -Raw).Trim()
$privateKey = (Get-Content $privateKeyPath -Raw).Trim()

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $tauriToolsDir) | Out-Null
if (Test-Path $tauriToolsDir) {
  Remove-Item $tauriToolsDir -Recurse -Force
}
Copy-Item $wixDir $tauriToolsDir -Recurse -Force

$buildCmd = "set `"VSCMD_START_DIR=%CD%`" && call `"$devCmd`" -arch=amd64 && set `"PATH=$env:USERPROFILE\.cargo\bin;$wixDir;%PATH%`" && npm run tauri:build:msi"

Push-Location $frontendDir
try {
  $env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password
  cmd.exe /d /c $buildCmd

  $msi = Get-ChildItem $bundleDir -Filter *.msi | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $msi) {
    throw "MSI artifact not found in $bundleDir"
  }

  $sigPath = "$($msi.FullName).sig"
  if (-not (Test-Path $sigPath)) {
    npx tauri signer sign -f $privateKeyPath -p $password $msi.FullName
  }

  if (-not (Test-Path $sigPath)) {
    throw "Updater signature not generated for $($msi.Name)"
  }

  Write-Host "Built MSI: $($msi.FullName)"
  Write-Host "Created signature: $sigPath"
}
finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
