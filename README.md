# Device Control Center

基于 **Tauri 2 + React 18 + Go** 的桌面端云实例管理工具。支持实例总览、VNC 远程桌面、屏幕墙、SSH 终端等功能。

## 项目结构

```
DeviceControlCenter/
├── frontend/desktop-app/    # Tauri 2 桌面客户端 (React + TypeScript + Vite)
│   ├── src/                 # 前端源码
│   │   ├── views/           # 页面组件
│   │   ├── components/      # 通用组件
│   │   ├── stores/          # Zustand 状态管理
│   │   ├── api/             # API 请求封装
│   │   └── styles.css       # 全局样式
│   └── src-tauri/           # Tauri/Rust 层（启动器 + sidecar 管理）
├── backend/api/             # Go + Gin 聚合后端（作为 sidecar 随桌面端分发）
│   ├── cmd/server/          # 入口
│   ├── internal/            # 业务逻辑（路由、代理、VNC、SSH）
│   └── config/              # 运行时配置
└── scripts/                 # 构建与启动脚本 (PowerShell)
```

---

## 环境准备

在开始之前，确保已安装以下工具：

| 工具 | 最低版本 | 用途 | 安装方式 |
|------|---------|------|---------|
| **Node.js** | v18+ | 前端构建 | [nodejs.org](https://nodejs.org/) |
| **npm** | v9+ | 包管理（随 Node.js 安装） | — |
| **Go** | 1.22+ | 后端编译 | [go.dev/dl](https://go.dev/dl/) |
| **Rust** | 1.77+ | Tauri 桌面壳编译 | [rustup.rs](https://rustup.rs/) |
| **Visual Studio Build Tools** | 2022 | Rust/C++ 编译链 | [Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |

> **Windows 用户：** 安装 Visual Studio Build Tools 时勾选 **"使用 C++ 的桌面开发"** 工作负载。Rust 编译 Tauri 需要 MSVC 工具链。

### 验证安装

```powershell
node -v       # 应输出 v18.x 或更高
npm -v        # 应输出 9.x 或更高
go version    # 应输出 go1.22 或更高
rustc -V      # 应输出 rustc 1.77 或更高
cargo -V      # 应输出 cargo 1.77 或更高
```

---

## 快速开始

### 1. 克隆代码

```powershell
git clone https://github.com/opencecs/desktop-client.git
cd desktop-client
```

### 2. 配置环境变量

```powershell
# 后端配置
copy backend\api\.env.example backend\api\.env

# 前端配置（可选，默认值即可使用）
copy frontend\desktop-app\.env.example frontend\desktop-app\.env.local
```

后端 `.env` 默认内容：

```env
SERVER_ADDR=:8080
UPSTREAM_BASE_URL=https://www.opencecs.com/api/v1
REQUEST_TIMEOUT_MS=15000
DESKTOP_RULES_PATH=config/desktop_rules.json
```

### 3. 安装前端依赖

```powershell
cd frontend\desktop-app
npm install
cd ..\..
```

### 4. 一键启动（开发模式）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

这会同时启动：
- **Go 后端** → `http://127.0.0.1:8080`
- **Vite 前端** → `http://127.0.0.1:5173`（浏览器开发模式，API 通过 Vite 代理转发到后端）

也可以分别手动启动：

```powershell
# 终端 1：启动后端
cd backend\api
go run ./cmd/server

# 终端 2：启动前端
cd frontend\desktop-app
npm run dev
```

### 5. Tauri 桌面开发模式

如果需要在 Tauri 桌面窗口中调试：

```powershell
cd frontend\desktop-app
npm run tauri:dev
```

> Tauri 模式下前端直接请求 `http://127.0.0.1:8080/api`，需要先单独启动后端。

---

## 构建桌面客户端

### 一键构建（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop.ps1
```

该脚本会按顺序执行：

1. 临时关闭 `createUpdaterArtifacts`（避免需要签名密钥）
2. 编译 Go 后端为 sidecar 可执行文件（`backend/api/bin/device-control-backend-x86_64-pc-windows-msvc.exe`）
3. 编译 Tauri 桌面客户端（包含前端构建 + Rust 编译）
4. 恢复配置文件

构建产物：

```
frontend/desktop-app/src-tauri/target/release/
├── desktop-app.exe                              # 可执行文件
└── bundle/msi/
    └── Device Control Center_1.0.0_x64_en-US.msi  # MSI 安装包
```

### 手动构建

```powershell
# 1. 编译后端 sidecar
cd backend\api
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -o bin/device-control-backend-x86_64-pc-windows-msvc.exe ./cmd/server

# 2. 编译桌面客户端
cd ..\..\frontend\desktop-app
npx tauri build
```

> **注意：** sidecar 文件名必须包含目标三元组后缀 `x86_64-pc-windows-msvc`，Tauri 按此规则查找。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Tauri 2 (Rust) — 窗口管理、sidecar 进程管理、自动更新 |
| 前端 | React 18 + TypeScript + Vite |
| 状态管理 | Zustand |
| 远程桌面 | noVNC (WebSocket VNC) |
| 终端 | xterm.js (WebSocket SSH) |
| 后端 | Go + Gin — API 代理、VNC/SSH WebSocket 转发 |
| 上游 API | OpenCECS 平台 (`https://www.opencecs.com/api/v1`) |

## 运行架构

```
┌─────────────────────────────────────────────┐
│              Tauri 桌面窗口                   │
│  ┌───────────────────────────────────────┐   │
│  │     React 前端 (WebView)              │   │
│  │  VNC 屏幕墙 / SSH 终端 / 实例管理      │   │
│  └────────────────┬──────────────────────┘   │
│                   │ HTTP / WebSocket          │
│  ┌────────────────▼──────────────────────┐   │
│  │     Go 后端 (Sidecar, :8080)          │   │
│  │  认证代理 / 实例聚合 / VNC&SSH 转发    │   │
│  └────────────────┬──────────────────────┘   │
└───────────────────┼─────────────────────────┘
                    │ HTTPS
          ┌─────────▼─────────┐
          │  OpenCECS 上游 API │
          └───────────────────┘
```

## 常见问题

### WebView2 缺失

Tauri 2 在 Windows 上依赖 WebView2 运行时。Windows 10 1803+ 和 Windows 11 通常预装。如果运行时提示缺失，从 [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 下载安装。

### 端口 8080 被占用

后端默认监听 `:8080`，如果冲突，修改 `backend/api/.env` 中的 `SERVER_ADDR`：

```env
SERVER_ADDR=:9090
```

同时修改前端环境变量 `frontend/desktop-app/.env.local`：

```env
VITE_API_BASE_URL=http://127.0.0.1:9090/api
```

### Rust 编译慢

首次编译 Tauri (Rust) 需要下载和编译依赖，可能需要 5-15 分钟。后续增量编译会快很多。

### Go 第三方依赖

项目使用 `replace` 指令将 Gin 框架指向本地 `third_party/gin` 目录，无需额外下载。其他依赖通过 `go mod` 自动管理。

## Desktop Client

真正的桌面客户端可执行文件和 MSI 安装包都可以生成：

- `frontend/desktop-app/src-tauri/target/release/desktop-app.exe`
- `frontend/desktop-app/src-tauri/target/release/bundle/msi/Device Control Center_0.1.1_x64_en-US.msi`

直接启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-desktop-client.ps1
```

当前桌面客户端在打包构建时会把 Go 后端一起作为 sidecar 打进安装包。
安装 MSI 后，客户端启动时会先探测 `http://127.0.0.1:8080/healthz`，本地后端未运行时会自动拉起，无需再手动执行 `start-backend.ps1`。

## MSI And Auto Update

### WiX 是干什么的

`WiX` 是 `Windows Installer XML` 工具链。Tauri 在 Windows 上生成 `.msi` 安装包时，底层会调用 WiX。

- 没有 WiX：仍然可以运行 `desktop-app.exe`
- 有 WiX：才能构建标准 Windows 安装包 `.msi`
- 自动更新链路推荐基于 `.msi + latest.json + .sig` 这一套发布物

本仓库已经使用本地 WiX，位置在：

- `tools/wix314`

并且会在构建时同步到 Tauri 本地工具目录，避免 Tauri 再去远程下载。

### 构建 MSI

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop-msi.ps1
```

这个脚本会完成：

- 复用本地 `tools/wix314`
- 构建 Tauri Windows MSI
- 使用本地 updater 私钥生成 `.sig` 签名文件

### 发布本地更新清单

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-updates.ps1
```

会生成：

- `releases/latest.json`
- `releases/windows-x86_64/*.msi`
- `releases/windows-x86_64/*.msi.sig`

### 启动本地更新源

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\serve-updates.ps1
```

默认地址：

- `http://127.0.0.1:8787/latest.json`

桌面客户端右上角已有 `检查更新` 按钮。当前如果本地发布的版本号和客户端一致，会提示已经是最新版本。

### 本地升级演练

当前仓库已经切到 `0.1.1`。为了验证从 `0.1.0` 升级到 `0.1.1`，保留了 `0.1.0` 基线归档：

- `releases/archive/0.1.0/windows-x86_64`

演练顺序：

1. 安装 `0.1.0` 的 MSI 基线包
2. 启动 `0.1.1` 的本地更新源
3. 打开 `0.1.0` 客户端，点击右上角 `检查更新`
4. 客户端下载 `0.1.1` MSI 并执行升级

### 本地联调检查

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-local-setup.ps1
```

这个脚本只做环境说明，不改任何文件。适合联调前快速确认上游配置和更新源是否已经配好。

## Development Standards

- 所有新增代码必须补充必要注释，只解释不明显的业务分支、兼容逻辑和数据归一化点。
- 所有新增代码必须带维护日志，日志要面向排障，默认克制，不刷屏。
- 日志必须支持开关或环境控制，开发和联调时可打开，默认生产输出保持最小化。
