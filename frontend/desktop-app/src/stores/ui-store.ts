import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => {
    console.log("[UiStore] toggleSidebar: current state", state.sidebarCollapsed, "->", !state.sidebarCollapsed);
    return { sidebarCollapsed: !state.sidebarCollapsed };
  }),
  setSidebarCollapsed: (collapsed) => set((state) => {
    console.log("[UiStore] setSidebarCollapsed:", collapsed);
    return { sidebarCollapsed: collapsed };
  }),
}));
