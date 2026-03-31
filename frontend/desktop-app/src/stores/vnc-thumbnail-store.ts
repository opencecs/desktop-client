import { create } from "zustand";

interface VncPasswordState {
  /** instanceId → VNC 密码（连接成功后保存） */
  passwords: Map<string, string>;
  /** 保存设备的 VNC 密码 */
  setPassword: (instanceId: string, password: string) => void;
  /** 获取设备的 VNC 密码 */
  getPassword: (instanceId: string) => string;
}

/** 默认 VNC 密码 */
export const DEFAULT_VNC_PASSWORD = "123456";

export const useVncPasswordStore = create<VncPasswordState>((set, get) => ({
  passwords: new Map(),
  setPassword: (instanceId, password) =>
    set((state) => {
      const next = new Map(state.passwords);
      next.set(instanceId, password);
      return { passwords: next };
    }),
  getPassword: (instanceId) => get().passwords.get(instanceId) ?? DEFAULT_VNC_PASSWORD,
}));
