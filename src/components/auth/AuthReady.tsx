"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

/**
 * Holds its children back while the session is still being checked, so a
 * signed-in person is not shown "Sign in first" for the moment before it
 * answers. The app no longer covers every page while it checks; the few
 * places that would say the wrong thing in that moment wait here instead.
 */
export function AuthReady({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking your sign-in…
      </div>
    );
  }
  return <>{children}</>;
}
