import { create } from "zustand";

type SessionState = {
  token: string | null;
  user: { user_id: string; username: string; email?: string; phone?: string } | null;
  setSession: (token: string, user: SessionState["user"]) => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  user: null,
  setSession: (token, user) => set({ token, user }),
  clearSession: () => set({ token: null, user: null })
}));
