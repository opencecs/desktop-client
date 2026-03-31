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
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: string }).message)
        : `请求失败 (${response.status})`;
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

