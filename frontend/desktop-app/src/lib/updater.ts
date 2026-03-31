import { executableDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

export type AppUpdateState =
  | { status: "unavailable"; message: string }
  | { status: "latest"; message: string }
  | { status: "downloading"; message: string }
  | { status: "updated"; message: string }
  | { status: "error"; message: string };

const DEFAULT_UPDATE_ENDPOINT = "http://127.0.0.1:8787/latest.json";
const STORAGE_KEY = "dcc_update_endpoint";

/** 获取当前配置的更新渠道地址 */
export function getUpdateEndpoint(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_UPDATE_ENDPOINT;
  } catch {
    return DEFAULT_UPDATE_ENDPOINT;
  }
}

/** 保存更新渠道地址 */
export function setUpdateEndpoint(url: string) {
  localStorage.setItem(STORAGE_KEY, url.trim());
}

/** 获取默认更新渠道地址 */
export function getDefaultEndpoint(): string {
  return DEFAULT_UPDATE_ENDPOINT;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function formatUpdateError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "检查更新失败";
  }
}

export function isPortableDevBuildPath(path: string) {
  return /[\\/]src-tauri[\\/]target[\\/](debug|release)/i.test(path);
}

async function ensureUpdateServerReachable(endpoint: string) {
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`更新源不可用：${response.status}`);
  }
}

export async function checkAndInstallUpdate(onState?: (state: AppUpdateState) => void): Promise<AppUpdateState> {
  if (!isTauriRuntime()) {
    return {
      status: "unavailable",
      message: "当前是浏览器开发模式，自动更新只在桌面客户端内可用。",
    };
  }

  try {
    const dir = await executableDir();
    if (isPortableDevBuildPath(dir)) {
      throw new Error("当前运行的是开发目录里的 desktop-app.exe。请先安装 MSI 安装包，再在安装版客户端里执行检查更新。");
    }

    const endpoint = getUpdateEndpoint();
    await ensureUpdateServerReachable(endpoint);
    onState?.({ status: "downloading", message: "正在检查更新..." });

    const result = await invoke<{ status: string; message: string; version: string | null }>("check_update_from", { endpoint });

    if (result.status === "updated") {
      const state = { status: "updated", message: result.message } as const;
      onState?.(state);
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
      return state;
    }

    const state = { status: "latest", message: result.message } as const;
    onState?.(state);
    return state;
  } catch (error) {
    const state = {
      status: "error",
      message: formatUpdateError(error),
    } as const;
    onState?.(state);
    return state;
  }
}
