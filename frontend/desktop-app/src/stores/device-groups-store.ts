/**
 * 设备分组状态管理 — 支持自定义设备分组、标签和常用组
 * 基于 Zustand 实现持久化设备分组管理
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createLogger } from "@/lib/logger";

const logger = createLogger("device-groups-store");

/** 设备分组 */
export interface DeviceGroup {
  /** 分组唯一 ID */
  id: string;
  /** 分组名称 */
  name: string;
  /** 分组描述 */
  description?: string;
  /** 分组内的设备 ID 列表 */
  instanceIds: string[];
  /** 分组颜色标签 */
  color?: string;
  /** 创建时间 */
  createdAt: string;
}

interface DeviceGroupsState {
  /** 所有分组列表 */
  groups: DeviceGroup[];
  /** 创建新分组 */
  createGroup: (name: string, instanceIds: string[], description?: string, color?: string) => DeviceGroup;
  /** 更新分组 */
  updateGroup: (id: string, updates: Partial<Pick<DeviceGroup, "name" | "description" | "color" | "instanceIds">>) => void;
  /** 删除分组 */
  deleteGroup: (id: string) => void;
  /** 向分组添加设备 */
  addDevicesToGroup: (groupId: string, instanceIds: string[]) => void;
  /** 从分组移除设备 */
  removeDevicesFromGroup: (groupId: string, instanceIds: string[]) => void;
}

/** 生成简短唯一 ID */
function generateGroupId(): string {
  return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 设备分组 Store
 * 使用 localStorage 持久化分组配置
 */
export const useDeviceGroupsStore = create<DeviceGroupsState>()(
  persist(
    (set) => ({
      groups: [],

      createGroup: (name, instanceIds, description, color) => {
        const newGroup: DeviceGroup = {
          id: generateGroupId(),
          name,
          description,
          instanceIds: [...new Set(instanceIds)], // 去重
          color,
          createdAt: new Date().toISOString(),
        };
        logger.info("group:create", { id: newGroup.id, name, deviceCount: instanceIds.length });
        set((state) => ({ groups: [...state.groups, newGroup] }));
        return newGroup;
      },

      updateGroup: (id, updates) => {
        logger.info("group:update", { id, updates: Object.keys(updates) });
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === id ? { ...g, ...updates } : g
          ),
        }));
      },

      deleteGroup: (id) => {
        logger.info("group:delete", { id });
        set((state) => ({
          groups: state.groups.filter((g) => g.id !== id),
        }));
      },

      addDevicesToGroup: (groupId, instanceIds) => {
        logger.info("group:addDevices", { groupId, count: instanceIds.length });
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === groupId
              ? { ...g, instanceIds: [...new Set([...g.instanceIds, ...instanceIds])] }
              : g
          ),
        }));
      },

      removeDevicesFromGroup: (groupId, instanceIds) => {
        logger.info("group:removeDevices", { groupId, count: instanceIds.length });
        const removeSet = new Set(instanceIds);
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === groupId
              ? { ...g, instanceIds: g.instanceIds.filter((id) => !removeSet.has(id)) }
              : g
          ),
        }));
      },
    }),
    {
      name: "device-groups",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
