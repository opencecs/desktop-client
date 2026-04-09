/**
 * 在系统默认浏览器中打开外部链接。
 * Tauri 环境下调用 Rust 命令，浏览器环境下用 window.open。
 */
export async function openExternal(url: string): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
