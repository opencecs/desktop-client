# 编译桌面客户端（不含签名，开发/测试用）
# 用法：powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop.ps1

$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend\desktop-app"
$backendDir  = Join-Path $repoRoot "backend\api"
$tauriConf   = Join-Path $frontendDir "src-tauri\tauri.conf.json"
$backupConf  = "$tauriConf.bak"
$releaseDir  = Join-Path $frontendDir "src-tauri\target\release"
$backendBinDir = Join-Path $backendDir "bin"
$targetTriple = "x86_64-pc-windows-msvc"
$backendSidecarBase = Join-Path $backendBinDir "device-control-backend"
$backendSidecarExe = "$backendSidecarBase-$targetTriple.exe"

Write-Host "===== 编译桌面客户端 =====" -ForegroundColor Cyan

# 1. 备份 tauri.conf.json，临时关闭 createUpdaterArtifacts（避免需要签名密钥）
Write-Host "[1/4] 处理配置文件..."
Copy-Item $tauriConf $backupConf -Force
$conf = Get-Content $tauriConf -Raw | ConvertFrom-Json
if ($conf.bundle.createUpdaterArtifacts) {
    $conf.bundle.createUpdaterArtifacts = $false
    $jsonText = $conf | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($tauriConf, $jsonText, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  已临时关闭 createUpdaterArtifacts" -ForegroundColor Yellow
}

try {
    # 2. 编译后端 sidecar，供桌面客户端和 MSI 一起分发
    Write-Host "[2/4] 编译 Go 后端 sidecar..."
    New-Item -ItemType Directory -Force -Path $backendBinDir | Out-Null
    Push-Location $backendDir
    $env:GOCACHE = Join-Path $backendDir ".cache\\go-build"
    $env:GOMODCACHE = Join-Path $backendDir ".cache\\gomod"
    $env:CGO_ENABLED = "0"
    go build -ldflags="-s -w" -o $backendSidecarExe ./cmd/server 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Go 后端编译失败" }
    Pop-Location
    Write-Host "  后端 sidecar 已生成: $backendSidecarExe" -ForegroundColor Green

    # 3. 编译 Tauri 桌面客户端
    Write-Host "[3/4] 编译 Tauri 桌面客户端（耗时较长）..."
    # 确保 Cargo/Rust 工具链在 PATH 中
    $cargoDir = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path $cargoDir) -and ($env:PATH -notlike "*$cargoDir*")) {
        $env:PATH = "$cargoDir;$env:PATH"
        Write-Host "  已添加 Cargo 到 PATH" -ForegroundColor Yellow
    }
    Push-Location $frontendDir
    npx tauri build 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Tauri 编译失败" }
    Pop-Location
    Write-Host "  Tauri 编译通过" -ForegroundColor Green

    # 4. 输出结果
    Write-Host "[4/4] 编译完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "可执行文件: $releaseDir\desktop-app.exe"

    $msi = Get-ChildItem "$releaseDir\bundle\msi" -Filter *.msi -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($msi) {
        Write-Host "MSI 安装包: $($msi.FullName)"
    }
}
finally {
    # 恢复原始配置
    if (Test-Path $backupConf) {
        Copy-Item $backupConf $tauriConf -Force
        Remove-Item $backupConf -Force
        Write-Host "  已恢复 tauri.conf.json" -ForegroundColor Yellow
    }
}
