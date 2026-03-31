import { describe, expect, it } from "vitest";
import { formatUpdateError, isPortableDevBuildPath } from "./updater";

describe("updater helpers", () => {
  it("detects portable dev build paths", () => {
    expect(isPortableDevBuildPath("C:\\repo\\frontend\\desktop-app\\src-tauri\\target\\release")).toBe(true);
    expect(isPortableDevBuildPath("C:\\Program Files\\Device Control Center")).toBe(false);
  });

  it("formats unknown updater errors", () => {
    expect(formatUpdateError(new Error("network failed"))).toBe("network failed");
    expect(formatUpdateError("plain text")).toBe("plain text");
    expect(formatUpdateError({ code: "E_FAIL" })).toContain("E_FAIL");
  });
});
