"use client";

import { useEffect } from "react";
import {
  REF_COOKIE,
  REF_COOKIE_MAX_AGE_SECONDS,
  encodeRefCookie,
  normalizeReferralCode,
} from "@/lib/campaign/referral-code";

/**
 * Keeps a campaign referral code (`/campaign?ref=CODE`) for 30 days, so the
 * sign-up that follows, now or later, counts as referred.
 *
 * A first-party cookie, SameSite=Lax, readable by the server at sign-up and
 * at the auth return. It holds the code and when the link was followed, and
 * nothing about the person. Read from window.location rather than
 * useSearchParams so the page stays static.
 */
export function RefCapture() {
  useEffect(() => {
    const code = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
    if (!code) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${REF_COOKIE}=${encodeRefCookie(code, new Date())}; Max-Age=${REF_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  }, []);
  return null;
}
