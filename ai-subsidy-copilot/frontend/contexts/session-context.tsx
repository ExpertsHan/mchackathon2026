"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DemoUser } from "@/lib/types";
import { clearDemoToken, readDemoToken, writeDemoToken } from "@/lib/demo-auth";

const USER_KEY = "ai-subsidy-demo-user";
const APPLICATION_KEY = "ai-subsidy-active-application";

interface SessionContextValue {
  user: DemoUser | null;
  activeApplicationId: string | null;
  hydrated: boolean;
  setDemoSession: (user: DemoUser, token: string) => void;
  setActiveApplicationId: (id: string | null) => void;
  clearSession: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<DemoUser | null>(null);
  const [activeApplicationId, setApplicationState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let nextUser: DemoUser | null = null;
    let nextApplication: string | null = null;
    try {
      const storedUser = window.localStorage.getItem(USER_KEY);
      const storedApplication = window.localStorage.getItem(APPLICATION_KEY);
      const storedToken = readDemoToken();
      if (storedUser && storedToken) {
        nextUser = JSON.parse(storedUser) as DemoUser;
        if (storedApplication) nextApplication = storedApplication;
      } else {
        window.localStorage.removeItem(USER_KEY);
        window.localStorage.removeItem(APPLICATION_KEY);
        clearDemoToken();
      }
    } catch {
      window.localStorage.removeItem(USER_KEY);
      window.localStorage.removeItem(APPLICATION_KEY);
    }
    const timer = window.setTimeout(() => {
      setUserState(nextUser);
      setApplicationState(nextApplication);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setDemoSession = useCallback((nextUser: DemoUser, token: string) => {
    setUserState(nextUser);
    setApplicationState(null);
    writeDemoToken(token);
    try {
      window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      window.localStorage.removeItem(APPLICATION_KEY);
    } catch {
      // React state and the in-memory token keep this tab usable without storage.
    }
  }, []);

  const setActiveApplicationId = useCallback((id: string | null) => {
    setApplicationState(id);
    try {
      if (id) window.localStorage.setItem(APPLICATION_KEY, id);
      else window.localStorage.removeItem(APPLICATION_KEY);
    } catch {
      // The active application remains available in React state for this tab.
    }
  }, []);

  const clearSession = useCallback(() => {
    setUserState(null);
    setApplicationState(null);
    clearDemoToken();
    try {
      window.localStorage.removeItem(USER_KEY);
      window.localStorage.removeItem(APPLICATION_KEY);
    } catch {
      // In-memory session state has already been cleared.
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      activeApplicationId,
      hydrated,
      setDemoSession,
      setActiveApplicationId,
      clearSession,
    }),
    [user, activeApplicationId, hydrated, setDemoSession, setActiveApplicationId, clearSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
