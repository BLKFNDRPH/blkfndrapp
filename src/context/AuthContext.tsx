"use client";

import type { User as AppUser } from "@/lib/types";
import {
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

import { isStellarPublicKey } from "@/lib/freighter-connect";

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (role?: "user" | "admin") => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function useAppSession() {
  const [session, setSession] = useState<{ user: AppUser } | null>(null);
  const [status, setStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");

  const refresh = useCallback(async (): Promise<{ user: AppUser } | null> => {
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
    (sessionOverride?: { user: AppUser } | null): AppUser | null => {
      const activeSession = sessionOverride ?? session;
      if (!activeSession?.user) return null;
      const uid = activeSession.user.uid;
      const avatar =
        activeSession.user.creatorAvatar || `https://i.pravatar.cc/150?u=${uid}`;
      // Checked the way FreighterWalletProvider checks the same value when it
      // restores an address on load, so the two agree on whether there is one.
      const linkedKey = isStellarPublicKey(activeSession.user.stellarPublicKey)
        ? activeSession.user.stellarPublicKey
        : "";

      return {
        uid,
        email: activeSession.user.email || "",
        name: activeSession.user.name || "Anonymous",
        avatarUrl: avatar,
        creatorAvatar: avatar,
        // From the platform_admins roster, read fresh by /api/auth/session — the
        // same answer the server enforces. Never the login dialog's role: which
        // button someone clicked says nothing about whether they are an admin.
        role: activeSession.user.role === "admin" ? "admin" : "user",
        // The wallet linked to this account, which it proved control of by
        // signing a challenge. It is the account's record, not the wallet in
        // use: that is freighterWalletAddress, which FreighterWalletProvider
        // seeds from this same value on load and then leaves to the person.
        // This context no longer pushes the key back into it. An effect did
        // that whenever the two differed, which reverted any wallet the person
        // had just connected or linked.
        wallet:
          linkedKey && activeSession.user.wallet === "connected"
            ? "connected"
            : "disconnected",
        stellarPublicKey: linkedKey,
      };
    },
    [session],
  );

  const refreshUser = useCallback(async () => {
    const freshSession = await refreshSession();
    const appUser = buildUserFromSession(freshSession);
    if (appUser) {
      setUser(appUser);
    } else {
      setUser(null);
    }
  }, [refreshSession, buildUserFromSession]);

  // Load user on session auth
  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;
    const appUser = buildUserFromSession();
    if (appUser) {
      setUser(appUser);
    }
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
      const appUser = buildUserFromSession(freshSession);
      if (appUser) {
        setUser(appUser);
      }
    }
  }, [loginRole, refreshSession, buildUserFromSession]);

  const handleLogout = useCallback(async () => {
    try {
      sessionStorage.removeItem("userRole");
      // Signing out leaves the wallet alone. The link between an account and
      // its wallet is durable: it is what the person's stakes and votes key
      // on, and the next sign-in picks it straight up. Until this, signing out
      // also unlinked the wallet, so every return meant setting it up again.
      // "Disconnect for now" in the wallet panel is the explicit action.
      setUser(null);
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        title: "Couldn't sign you out",
        description: "Check your connection and try again.",
      });
    }
  }, [toast]);

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
