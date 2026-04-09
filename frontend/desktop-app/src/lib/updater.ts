import { executableDir } from "@tauri-apps/api/path";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

export type AppUpdateState =
  | { status: "unavailable"; message: string }
  | { status: "latest"; message: string }
  | { status: "downloading"; message: string }
  | { status: "updated"; message: string }
  | { status: "error"; message: string };

/** 远程版本查询结果 */
export interface VersionCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  manifestUrl?: string;
  downloadUrl?: string;
  fileSize?: number;
  checksum?: string;
  message: string;
}

const VERSION_CHECK_API = "https://newapi.moyunteng.com/api/v1/dcc-client/update";
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
  const raw = error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : undefined;

  if (raw) {
    if (/unknown path/i.test(raw)) {
      return "更新包路径解析失败（unknown path）。请确认平台 zip 中包含 latest.json 与 windows-x86_64 安装包，并查看日志：%TEMP%/device-control-center/updater.log";
    }
    return raw;
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

async function isDevPortableBuild(): Promise<boolean> {
  try {
    const dir = await executableDir();
    return isPortableDevBuildPath(dir);
  } catch {
    // Some runtimes may not resolve executableDir and throw "unknown path".
    // Do not block updater flow in this case.
    return false;
  }
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

async function ensureUpdateServerReachable(endpoint: string) {
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`更新源不可用：${response.status}`);
  }
}

function deriveManifestUrlFromDownload(downloadUrl?: string): string | undefined {
  if (!downloadUrl) return undefined;
  const trimmed = downloadUrl.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/[^/]+$/, "latest.json");
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function resolveRemoteUpdateEndpoint(versionResult: VersionCheckResult): Promise<string> {
  const configured = getUpdateEndpoint().trim();
  const candidates = [
    versionResult.manifestUrl,
    deriveManifestUrlFromDownload(versionResult.downloadUrl),
    configured,
  ].filter((v): v is string => Boolean(v && v.trim()));

  for (const endpoint of candidates) {
    try {
      await ensureUpdateServerReachable(endpoint);
      return endpoint;
    } catch {
      // try next candidate
    }
  }

  throw new Error("平台已返回新版本，但未提供可访问的 latest.json。请在平台同时发布 latest.json、msi、msi.sig。");
}

async function checkAndInstallUpdateFromEndpoint(endpoint: string, onState?: (state: AppUpdateState) => void): Promise<AppUpdateState> {
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
}

async function checkAndInstallUpdateFromZip(zipUrl: string, onState?: (state: AppUpdateState) => void): Promise<AppUpdateState> {
  onState?.({ status: "downloading", message: "正在下载更新压缩包并准备安装..." });

  const result = await invoke<{ status: string; message: string; version: string | null }>("check_update_from_zip", {
    zipUrl,
  });

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
}

/** 查询远程 API 是否有新版本（不安装） */
export async function checkVersionFromRemote(): Promise<VersionCheckResult> {
  if (!isTauriRuntime()) {
    return { hasUpdate: false, currentVersion: "dev", message: "浏览器开发模式，无法检查更新。" };
  }

  const currentVersion = await getVersion();

  try {
    if (await isDevPortableBuild()) {
      return { hasUpdate: false, currentVersion, message: "开发构建，跳过更新检查。" };
    }

    const url = `${VERSION_CHECK_API}?client_type=windows-amd64&version=${encodeURIComponent(currentVersion)}&channel=published`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`更新接口返回 ${resp.status}`);
    }

    const payload = await resp.json() as Record<string, unknown>;
    const code = pickNumber(payload, ["code", "code_id", "codeId"]);
    if (typeof code === "number" && code !== 200) {
      const msg = pickString(payload, ["msg", "message"]) || "平台更新接口返回业务错误";
      throw new Error(msg);
    }

    const rawData = (payload.data && typeof payload.data === "object")
      ? (payload.data as Record<string, unknown>)
      : payload;

    const latestVersion = pickString(rawData, ["version", "latestVersion", "latest_version"]);
    const notes = pickString(rawData, ["releaseNotes", "release_notes", "notes"]);
    const manifestUrl = pickString(rawData, ["manifestUrl", "manifest_url", "latestJsonUrl", "latest_json_url"]);
    const downloadUrl = pickString(rawData, ["downloadUrl", "download_url", "url"]);
    const fileSize = pickNumber(rawData, ["fileSize", "file_size", "size"]);
    const checksum = pickString(rawData, ["checksum", "sha256", "hash"]);
    const hasUpdate = Boolean(latestVersion && latestVersion !== currentVersion);

    return {
      hasUpdate,
      currentVersion,
      latestVersion: latestVersion || undefined,
      notes,
      manifestUrl,
      downloadUrl,
      fileSize,
      checksum,
      message: hasUpdate ? `发现新版本 ${latestVersion}` : "当前已是最新版本。",
    };
  } catch (error) {
    return { hasUpdate: false, currentVersion, message: formatUpdateError(error) };
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
    if (await isDevPortableBuild()) {
      throw new Error("当前运行的是开发目录里的 desktop-app.exe。请先安装 MSI 安装包，再在安装版客户端里执行检查更新。");
    }

    const endpoint = getUpdateEndpoint();
    return await checkAndInstallUpdateFromEndpoint(endpoint, onState);
  } catch (error) {
    const state = {
      status: "error",
      message: formatUpdateError(error),
    } as const;
    onState?.(state);
    return state;
  }
}

/**
 * 先通过平台 API 确认有新版本，再走 Tauri 更新通道下载并安装。
 * 这样可以与平台发布策略保持一致，避免直接依赖本地更新源判断。
 */
export async function checkAndInstallUpdateFromRemote(onState?: (state: AppUpdateState) => void): Promise<AppUpdateState> {
  const versionResult = await checkVersionFromRemote();

  if (!versionResult.hasUpdate) {
    const state = { status: "latest", message: versionResult.message } as const;
    onState?.(state);
    return state;
  }

  onState?.({
    status: "downloading",
    message: `平台检测到新版本 ${versionResult.latestVersion}，开始下载并安装...`,
  });

  try {
    const zipUrl = versionResult.downloadUrl?.trim();
    if (zipUrl && /\.zip(\?|$)/i.test(zipUrl)) {
      return await checkAndInstallUpdateFromZip(zipUrl, onState);
    }

    const endpoint = await resolveRemoteUpdateEndpoint(versionResult);
    return await checkAndInstallUpdateFromEndpoint(endpoint, onState);
  } catch (error) {
    const state = {
      status: "error",
      message: formatUpdateError(error),
    } as const;
    onState?.(state);
    return state;
  }
}
