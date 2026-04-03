import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WebRtcTokenState {
  /** 全局统一的 debian_screen_control 设备 token */
  globalToken: string;
  /** 设置全局 token */
  setGlobalToken: (token: string) => void;
}

/** 默认设备 token（留空，用户需在 WebRTC投屏工具栏手动填写设备端实际 token） */
export const DEFAULT_WEBRTC_TOKEN = "";

/**
 * WebRTC 设备 token Store
 * 使用 persist 中间件将 token 保存到 localStorage，页面刷新后不丢失。
 */
export const useWebRtcTokenStore = create<WebRtcTokenState>()(
  persist(
    (set) => ({
      globalToken: DEFAULT_WEBRTC_TOKEN,
      setGlobalToken: (token) => set({ globalToken: token }),
    }),
    { name: "webrtc-device-token" },
  ),
);
