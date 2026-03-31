# Frontend Desktop App

当前以前端壳运行，后续接入 Tauri 2。

## Run

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## Notes

- `vite.config.ts` 已将 `/api` 代理到本地 Go 服务。
- 自动更新能力将在接入 Tauri 2 后通过 updater 配置启用。
- 调试日志默认关闭；如需排障，在 `.env.local` 中设置 `VITE_DEBUG_LOGGING=true`。
- 新增代码请优先复用 `src/lib/logger.ts`，不要在页面里散落 `console.*`。
