$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend\desktop-app"
$privateKeyPath = Join-Path $repoRoot ".secrets\tauri\updater.key"
$bundleDir = Join-Path $frontendDir "src-tauri\target\release\bundle\msi"
$releasesDir = Join-Path $repoRoot "releases"

# 读取版本号
$packageJson = Get-Content (Join-Path $frontendDir "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
Write-Host "=== Building upgrade bundle v$version ==="

# 1. 构建 MSI
Write-Host "`n[1/3] Building MSI..."
$ErrorActionPreference = "Continue"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-desktop-msi.ps1") 2>&1
$ErrorActionPreference = "Stop"

$msi = Get-ChildItem $bundleDir -Filter "*_${version}_*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msi) {
  throw "MSI artifact not found for version $version in $bundleDir"
}
Write-Host "MSI: $($msi.Name)"

# 2. 签名（如果构建脚本未生成 sig，手动签名）
$sigPath = "$($msi.FullName).sig"
if (-not (Test-Path $sigPath)) {
  Write-Host "`n[2/3] Signing MSI..."
  if (-not (Test-Path $privateKeyPath)) {
    throw "Updater private key not found: $privateKeyPath"
  }
  Push-Location $frontendDir
  try {
    npx @tauri-apps/cli signer sign --private-key-path $privateKeyPath --password "" $msi.FullName
  } finally {
    Pop-Location
  }
  if (-not (Test-Path $sigPath)) {
    throw "Signing failed: $sigPath not generated"
  }
} else {
  Write-Host "`n[2/3] Signature already exists, skipping."
}
Write-Host "Sig: $($msi.Name).sig"

# 3. 打 zip 升级包
Write-Host "`n[3/3] Creating upgrade zip..."
$tmpDir = Join-Path $releasesDir "upload-bundle-$version"
$winDir = Join-Path $tmpDir "windows-x86_64"
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $winDir | Out-Null

Copy-Item $msi.FullName $winDir
Copy-Item $sigPath $winDir

# 生成 latest.json
$signature = (Get-Content $sigPath -Raw).Trim()
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$manifest = [ordered]@{
  version   = $version
  notes     = "Device Control Center v$version"
  pub_date  = $now
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url       = "http://127.0.0.1:8787/windows-x86_64/$($msi.Name)"
    }
  }
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
  (Join-Path $tmpDir "latest.json"),
  ($manifest | ConvertTo-Json -Depth 8),
  $utf8NoBom
)

# 压缩
$zipPath = Join-Path $releasesDir "upload-bundle-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($tmpDir, $zipPath)
Remove-Item $tmpDir -Recurse -Force

Write-Host "`n=== Done ==="
Write-Host "Upgrade bundle: $zipPath"
