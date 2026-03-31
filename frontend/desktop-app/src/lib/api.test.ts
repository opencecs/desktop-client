import { describe, expect, it, vi } from "vitest";
import { ApiError, getApiBaseUrl, isApiErrorKind } from "@/api/client";

describe("sanity", () => {
  it("keeps the test runner wired", () => {
    expect(1 + 1).toBe(2);
  });
});

describe("api client", () => {
  it("classifies api errors", () => {
    expect(isApiErrorKind(new ApiError("auth", "登录已过期"), "auth")).toBe(true);
    expect(isApiErrorKind(new ApiError("timeout", "请求超时"), "auth")).toBe(false);
  });

  it("reads api base url from env", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:9000/api");
    expect(getApiBaseUrl()).toBe("http://127.0.0.1:9000/api");
    vi.unstubAllEnvs();
  });
});
