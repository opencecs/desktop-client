# Backend API

## Run

```powershell
copy .env.example .env
go run ./cmd/server
```

### Configuration

后端通过 `UPSTREAM_BASE_URL` 环境变量配置上游 API 地址（默认 `https://www.opencecs.com/api/v1`）。

本地启动：

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\scripts\start-backend.ps1
```

桌面客户端 MSI 构建时会把后端编译为 sidecar：

- 输出文件：`backend/api/bin/device-control-backend-x86_64-pc-windows-msvc.exe`
- MSI 安装后由 Tauri 主进程自动拉起
- 客户端启动前会先探测 `http://127.0.0.1:8080/healthz`

指定上游地址：

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\scripts\start-backend.ps1 -UpstreamBaseUrl http://your-upstream/api/v1
```

## Test

```powershell
go test ./...
```

## Notes

- 后端代理真实上游接口，地址由 `UPSTREAM_BASE_URL` 控制。这个地址应当指向上游 API 根路径，后端会在其后拼接 `/auth` 和 `/cecs` 等路径。
- 当前真实联调默认基址已经更新为 `https://www.opencecs.com/api/v1`。
- 当前通过 `config/desktop_rules.json` 增补桌面系统判定规则，支持实例级覆盖。
- 实例列表的 `search`、`page`、`page_size`、`status` 会同步透传到上游；桌面系统过滤仍在本地聚合层执行。
- 端口映射列表支持 `protocol` 过滤；CRUD 和批量操作已纳入上游合同与测试层，后续前端交互按页面节奏接入。
- 若上游响应为 `{ "code": 200, "message": "success", "data": ... }`，服务会优先解析 `data`；若 `code != 200`，会按业务错误处理而不是误判为成功。
- 维护规范：新增代码需要保留必要注释和结构化日志，注释只写在不直观的分支和适配点，日志只保留启动、错误、慢请求和关键操作这类有排障价值的事件。
