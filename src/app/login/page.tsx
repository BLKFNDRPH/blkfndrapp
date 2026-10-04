"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import Loading from "@/app/loading";

/**
 * Where the auth routes send the browser afterwards. Nobody stays here.
 *
 * Every arrival says why it came: `checkEmail` after a sign-up, or an `error`
 * code from /auth/callback or /auth/confirm. Only an `error` is a failure. A
 * fresh sign-up has no session until the address is confirmed, so treating "no
 * session" as failure told every new email user their sign-up had failed — they
 * tried again, and Supabase logged a repeated sign-up.
 */
const FAILURES: Record<string, string> = {
  Provider: "Could not reach Google right now. Try again in a moment.",
  NoCode: "The sign-in response was incomplete. Try again.",
  Exchange: "The sign-in expired before it could finish. Try again.",
  InvalidLink: "That link is not valid. Request a new one.",
  LinkExpired: "That link has expired. Request a new one.",
};

function LoginLanding() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const hasHandledRef = useRef(false);

  const checkEmail = searchParams.has("checkEmail");
  const error = searchParams.get("error");

  useEffect(() => {
    // Guard against running twice (React strict mode / re-renders)
    if (hasHandledRef.current) return;

    // ── Sign-up accepted: no session yet is expected, not a failure ─────
    if (checkEmail) {
      hasHandledRef.current = true;
      router.replace("/");
      toast({
        title: "Check your inbox",
        description:
          "We sent a link to confirm your address. Open it on this device to come straight back here. Already have an account? Sign in instead.",
        // An instruction the user has to act on, not a notice: long enough to
        // read before it closes (the default is 5s).
        duration: 15000,
      });
      return;
    }

    // ── An auth route reported a failure ────────────────────────────────
    if (error) {
      hasHandledRef.current = true;
      router.replace("/");
      toast({
        title: "Sign-in didn't finish",
        description: FAILURES[error] ?? "Something went wrong signing you in. Try again.",
        variant: "destructive",
      });
      return;
    }

    // ── Success: user authenticated, go to profile ─────────────────────
    if (!loading && user) {
      hasHandledRef.current = true;
      router.replace("/profile");
      return;
    }

    // ── A plain visit without a session: nothing failed, offer sign-in ──
    if (!loading && !user) {
      hasHandledRef.current = true;
      router.replace("/");
      login();
      return;
    }

    // ── Still loading: safety timeout in case it hangs forever ─────────
    const timer = setTimeout(() => {
      if (hasHandledRef.current) return;
      hasHandledRef.current = true;
      router.replace("/");
      toast({
        title: "This is taking longer than usual",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }, 10000);

    return () => clearTimeout(timer);
  }, [checkEmail, error, loading, user, login, router, toast]);

  return <Loading />;
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for this page to prerender.
  return (
    <Suspense fallback={<Loading />}>
      <LoginLanding />
    </Suspense>
  );
}
