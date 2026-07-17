"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import Loading from "@/app/loading";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const hasHandledRef = useRef(false);

  useEffect(() => {
    // Guard against running twice (React strict mode / re-renders)
    if (hasHandledRef.current) return;

    // ── Success: user authenticated, go to profile ─────────────────────
    if (!loading && user) {
      hasHandledRef.current = true;
      router.push("/profile");
      return;
    }

    // ── No session after loading finished: login failed or cancelled ───
    // Redirect home and show a toast so the user knows what happened.
    if (!loading && !user) {
      hasHandledRef.current = true;
      router.push("/");
      toast({
        title: "Login failed",
        description: "Something went wrong signing you in. Please try again.",
        variant: "destructive",
      });
      return;
    }

    // ── Still loading: safety timeout in case it hangs forever ─────────
    const timer = setTimeout(() => {
      if (hasHandledRef.current) return;
      hasHandledRef.current = true;
      router.push("/");
      toast({
        title: "Login timed out",
        description: "Sign in took too long. Please try again.",
        variant: "destructive",
      });
    }, 10000);

    return () => clearTimeout(timer);
  }, [loading, user, router, toast]);

  return <Loading />;
}