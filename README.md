# Device Control Center

实例管理台 V1，采用前后端分离结构：

- `frontend/desktop-app`: Tauri 2 + React + TypeScript 桌面客户端，已实现登录、实例总览、实例详情、桌面控制占位页和自动更新入口。
- `backend/api`: Go + Gin 聚合后端，负责认证代理、实例聚合、桌面系统筛选与控制动作透传。
> **Note:** Phase 1-3 migrations (UI refinement, error boundaries, structure refactoring including `src/views/`, `src/stores/`, and `src/components/ui/`) have been successfully completed.
## Quick Start

### Backend

```powershell
cd backend/api
copy .env.example .env
go run ./cmd/server
```

后端启动后会代理真实上游接口，上游地址通过 `UPSTREAM_BASE_URL` 环境变量配置（默认 `https://www.opencecs.com/api/v1`）。

### Frontend

```powershell
cd frontend/desktop-app
npm install
npm run dev
```

前端会根据运行环境选择 API 基址：

- 浏览器开发模式默认走 `/api`，配合 Vite 代理
- Tauri 桌面模式默认走 `http://127.0.0.1:8080/api`
- 如需覆盖，复制 `frontend/desktop-app/.env.example` 为 `.env.local`

### One Command Local Start

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

默认前端运行在 `http://127.0.0.1:5173`，通过 `/api` 代理到本地 Go 服务。

如果要切到真实上游联调：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-http-local.ps1
```

当前真实联调默认上游：

- `https://www.opencecs.com/api/v1`

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
