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
