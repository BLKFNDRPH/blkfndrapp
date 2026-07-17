"use client";

import type { User as AppUser } from "@/lib/types";
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useToast } from "@/hooks/use-toast";
import { LoginDialog } from "@/components/auth/LoginDialog";
import Loading from "@/app/loading";
import type { SessionUser } from "@/lib/auth/session";
import { useFreighterWallet } from "@/context/FreighterWalletContext";

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (role?: "user" | "admin") => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fetchWithTimeout = async (url: string, ms = 8000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

function useAppSession() {
  const [session, setSession] = useState<{ user: SessionUser } | null>(null);
  const [status, setStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");

  const refresh = useCallback(async (): Promise<{ user: SessionUser } | null> => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (data?.user) {
        setSession(data);
        setStatus("authenticated");
        return data;
      }
      setSession(null);
      setStatus("unauthenticated");
      return null;
    } catch {
      setSession(null);
      setStatus("unauthenticated");
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data: session, status, refresh };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginRole, setLoginRole] = useState<"user" | "admin">("user");
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();
  const { data: session, status, refresh: refreshSession } = useAppSession();
  const loading = status === "loading";
  const { freighterWalletAddress, syncAddress, disconnectWallet: disconnectFreighter } =
    useFreighterWallet();

  useEffect(() => {
    if (loading) {
      setLoadingTimedOut(false);
      loadingTimerRef.current = setTimeout(
        () => setLoadingTimedOut(true),
        10000,
      );
    } else {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      setLoadingTimedOut(false);
    }
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [loading]);

  const buildUserFromSession = useCallback(
    async (
      role: "user" | "admin" = "user",
      sessionOverride?: { user: SessionUser } | null,
    ): Promise<AppUser | null> => {
      const activeSession = sessionOverride ?? session;
      if (!activeSession?.user) return null;
      const uid = activeSession.user.uid;

      let dbUser: any = {};
      try {
        const res = await fetchWithTimeout(`/api/user/${uid}`, 8000);
        if (res.ok) {
          dbUser = await res.json();
        } else if (res.status === 401) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const retry = await fetchWithTimeout(`/api/user/${uid}`, 8000);
          if (retry.ok) dbUser = await retry.json();
          else {
            console.error(`[Auth] User fetch still 401 after retry — aborting`);
            return null;
          }
        }
      } catch (err) {
        console.warn("User fetch timed out or failed:", err);
      }

      return {
        uid,
        email: activeSession.user.email || "",
        name: dbUser.name || activeSession.user.name || "Anonymous",
        avatarUrl:
          dbUser.creatorAvatar ||
          activeSession.user.image ||
          `https://i.pravatar.cc/150?u=${uid}`,
        creatorAvatar:
          dbUser.creatorAvatar ||
          activeSession.user.image ||
          `https://i.pravatar.cc/150?u=${uid}`,
        role: dbUser.role || role,
        wallet: dbUser.wallet || "disconnected",
        stellarPublicKey: dbUser.stellarPublicKey || "",
      };
    },
    [session],
  );

  // Keep Freighter context in sync when app session has a Stellar public key
  useEffect(() => {
    const stellarKey = user?.stellarPublicKey;
    if (stellarKey && stellarKey !== freighterWalletAddress) {
      if (typeof window !== "undefined" && localStorage.getItem("freighterDisconnected") === "true") {
        return;
      }
      syncAddress(stellarKey);
    }
  }, [user?.stellarPublicKey, freighterWalletAddress, syncAddress]);

  const refreshUser = useCallback(async () => {
    const freshSession = await refreshSession();
    const appUser = await buildUserFromSession(loginRole, freshSession);
    if (appUser) {
      setUser(appUser);
    } else {
      setUser(null);
    }
  }, [refreshSession, buildUserFromSession, loginRole]);

  // Load user on session auth
  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;
    (async () => {
      try {
        const appUser = await buildUserFromSession();
        if (appUser) {
          setUser(appUser);
        }
      } catch (err) {
        console.error("Session init error:", err);
      }
    })();
  }, [status, session, buildUserFromSession]);

  // Reset on logout
  useEffect(() => {
    if (status === "unauthenticated") {
      setUser(null);
    }
  }, [status]);

  const login = (role: "user" | "admin" = "user") => {
    setLoginRole(role);
    setLoginDialogOpen(true);
  };

  const handleLoginSuccess = useCallback(async () => {
    sessionStorage.setItem("userRole", loginRole);
    const freshSession = await refreshSession();
    if (freshSession?.user) {
      const appUser = await buildUserFromSession(loginRole, freshSession);
      if (appUser) {
        setUser(appUser);
      }
    }
  }, [loginRole, refreshSession, buildUserFromSession]);

  const handleLogout = useCallback(async () => {
    try {
      sessionStorage.removeItem("userRole");
      await disconnectFreighter();
      setUser(null);
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      toast({ title: "Logout Failed", description: "Could not log out." });
    }
  }, [toast, disconnectFreighter]);

  const showLoading = loading && !loadingTimedOut;

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout: handleLogout,
        loading,
        refreshUser,
      }}
    >
      {showLoading && <Loading />}
      {children}
      <LoginDialog
        isOpen={isLoginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
