import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DeviceCredentials {
  username: string;
  password: string;
}

interface WebRtcTokenState {
  /** 全局统一的 debian_screen_control 设备 token */
  globalToken: string;
  /** 设备登录凭据（持久化，用于自动登录） */
  credentials: DeviceCredentials;
  /** 设置全局 token */
  setGlobalToken: (token: string) => void;
  /** 设置设备登录凭据 */
  setCredentials: (creds: DeviceCredentials) => void;
  /** 清除 token 和凭据 */
  clear: () => void;
}

/**
 * WebRTC 设备 token Store
 * 使用 persist 中间件将 token 和凭据保存到 localStorage，页面刷新后不丢失。
 */
export const useWebRtcTokenStore = create<WebRtcTokenState>()(
  persist(
    (set) => ({
      globalToken: "",
      credentials: { username: "", password: "" },
      setGlobalToken: (token) => set({ globalToken: token }),
      setCredentials: (creds) => set({ credentials: creds }),
      clear: () => set({ globalToken: "", credentials: { username: "", password: "" } }),
    }),
    {
      name: "webrtc-device-token",
      version: 4,
      migrate: (_persisted, version) => {
        if (version < 4) {
          const old = (_persisted ?? {}) as Partial<WebRtcTokenState>;
          return {
            globalToken: old.globalToken ?? "",
            credentials: old.credentials ?? { username: "", password: "" },
          };
        }
        return _persisted as WebRtcTokenState;
      },
    },
  ),
);
