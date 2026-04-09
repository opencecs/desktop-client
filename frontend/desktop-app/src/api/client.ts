import { createLogger } from "@/lib/logger";

const DEFAULT_BROWSER_API_BASE_URL = "/api";
const DEFAULT_DESKTOP_API_BASE_URL = "http://127.0.0.1:8080/api";
const DEFAULT_TIMEOUT_MS = 15_000;
const apiLogger = createLogger("api");

export class ApiError extends Error {
  kind: "http" | "network" | "timeout" | "parse" | "auth";
  status?: number;
  details?: unknown;

  constructor(kind: "http" | "network" | "timeout" | "parse" | "auth", message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

const requestTimeoutMs = resolveRequestTimeoutMs();

export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

export function isApiErrorKind(error: unknown, kind: ApiError["kind"]) {
  return error instanceof ApiError && error.kind === kind;
}

export function describeApiError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "请求失败";
}

type RequestInitWithJson = RequestInit & {
  token?: string;
  json?: unknown;
};

export async function requestJson<T>(path: string, options: RequestInitWithJson = {}) {
  const apiBaseUrl = getApiBaseUrl();
  const headers = new Headers(options.headers ?? {});

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const init: RequestInit = {
    ...options,
    headers,
  };

  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.json);
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("timeout")), requestTimeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
    }
  }

  let response: Response;

  try {
    // Centralized request logging stays behind `VITE_DEBUG_LOGGING` so normal runs stay quiet.
    apiLogger.debug("request:start", { path, method: options.method ?? "GET", baseUrl: apiBaseUrl });
    response = await fetch(buildRequestUrl(path), {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      apiLogger.warn("request:timeout", { path, timeoutMs: requestTimeoutMs });
      throw new ApiError("timeout", `请求超时（${requestTimeoutMs / 1000} 秒），请检查后端是否在线`, undefined, error);
    }

    apiLogger.error("request:network-error", { path, error });
    throw new ApiError("network", "后端接口暂时不可用", undefined, error);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") && text ? safeParseJson(text) : text;
  apiLogger.debug("request:response", { path, status: response.status, ok: response.ok });

  if (response.status === 401) {
    throw new ApiError("auth", typeof payload === "object" && payload && "message" in payload ? String((payload as { message?: string }).message) : "登录已过期，请重新登录", response.status, payload);
  }

  if (!response.ok) {
    const serverMessage =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: string }).message)
        : "";
    // 后端透传的 upstream 技术错误对用户无意义，改用友好提示
    const isUpstreamTechnical = /^upstream\s/i.test(serverMessage);
    const message = (serverMessage && !isUpstreamTechnical) ? serverMessage : friendlyHttpMessage(response.status);
    apiLogger.warn("request:http-error", { path, status: response.status, message });
    throw new ApiError("http", message, response.status, payload);
  }

  if (payload === "") {
    return undefined as T;
  }

  return payload as T;
}

function resolveApiBaseUrl() {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (typeof envBaseUrl === "string" && envBaseUrl.trim()) {
    return envBaseUrl.trim().replace(/\/+$/, "");
  }

  return isTauriRuntime() ? DEFAULT_DESKTOP_API_BASE_URL : DEFAULT_BROWSER_API_BASE_URL;
}

function resolveRequestTimeoutMs() {
  const raw = import.meta.env.VITE_API_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}


function buildRequestUrl(path: string) {
  const normalizedBase = getApiBaseUrl().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError("parse", "响应解析失败", undefined, error);
  }
}

/** 将 HTTP 状态码映射为用户友好的中文提示 */
function friendlyHttpMessage(status: number): string {
  switch (status) {
    case 400: return "请求参数有误，请检查后重试";
    case 403: return "没有权限执行此操作";
    case 404: return "请求的资源不存在";
    case 408: return "服务器处理超时，请稍后重试";
    case 409: return "操作冲突，请刷新后重试";
    case 429: return "操作过于频繁，请稍后再试";
    case 500: return "服务器内部错误，请稍后重试";
    case 502: return "服务器暂时不可用，请稍后重试";
    case 503: return "服务正在维护中，请稍后重试";
    case 504: return "服务器响应超时，请稍后重试";
    default:
      if (status >= 500) return "服务器异常，请稍后重试";
      if (status >= 400) return "请求失败，请稍后重试";
      return "请求异常，请稍后重试";
  }
}

