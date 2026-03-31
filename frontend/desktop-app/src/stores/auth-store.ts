import { create } from "zustand";
import type { AuthSession } from "@/types";

const STORAGE_KEY = "dcc.console.session";

interface AuthState {
  session: AuthSession | null;
  hydrated: boolean;
  hydrate: () => void;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
}

function readSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hydrated: false,
  hydrate: () => {
    console.log("[AuthStore] hydrate: reading session from storage");
    const session = readSession();
    set({ session, hydrated: true });
  },
  setSession: (session) => {
    console.log("[AuthStore] setSession:", session);
    writeSession(session);
    set({ session });
  },
  clearSession: () => {
    console.log("[AuthStore] clearSession: removing session");
    writeSession(null);
    set({ session: null });
  },
}));
