"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

// Every export here is a public HTTP endpoint. Arguments are treated as
// hostile and validated before use.

export interface AuthActionResult {
  error?: string;
}

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(320),
  // Long minimum rather than a character-class rule: length is what resists
  // guessing, and composition rules mostly produce predictable substitutions.
  password: z.string().min(12, "Use at least 12 characters").max(72),
});

const Registration = Credentials.extend({
  name: z.string().trim().min(1, "Enter your name").max(80),
});

/**
 * Origins this deployment is allowed to send a user back to.
 *
 * NEXT_PUBLIC_APP_URL is the canonical one. APP_URLS adds more, comma
 * separated, for a deployment served from several domains — a staging host, a
 * vanity domain, a rename in progress.
 *
 * APP_URLS deliberately has no NEXT_PUBLIC_ prefix. Nothing here runs in the
 * browser, so it is read at request time and a new domain takes effect on
 * restart rather than needing the image rebuilt.
 */
function allowedOrigins(): string[] {
  const raw = [
    process.env.NEXT_PUBLIC_APP_URL ?? "",
    ...(process.env.APP_URLS ?? "").split(","),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim().replace(/\/+$/, "");
    if (!trimmed) continue;
    try {
      // Parse rather than pattern-match, so a malformed entry is dropped
      // instead of becoming a redirect target nobody intended.
      const url = new URL(trimmed);
      const origin = url.origin;
      if (!seen.has(origin)) {
        seen.add(origin);
        out.push(origin);
      }
    } catch {
      console.warn(`[auth] Ignoring unparseable origin in configuration: ${entry}`);
    }
  }
  return out;
}

/**
 * Where to send the user back to after Supabase finishes with them.
 *
 * This used to return NEXT_PUBLIC_APP_URL whenever it was set, which pinned
 * every redirect to one domain. A visitor arriving on a second domain would
 * sign in and land on the first, losing the session they had just established
 * because the cookie was set for the host they were sent to.
 *
 * So the request's own Host decides — but only when it is one we recognise.
 * The Host header is attacker-controlled, and echoing it unchecked into a
 * redirect is how an open redirect happens; matching against the configured
 * list first means an unknown host silently gets the canonical origin instead.
 *
 * Supabase's own redirect allow-list is a second gate behind this one, and
 * every origin here has to appear there too or Supabase will refuse the
 * redirect it is handed.
 */
async function originFromRequest(): Promise<string> {
  const allowed = allowedOrigins();

  const headerList = await headers();
  const host = headerList.get("host")?.trim();

  if (host) {
    const match = allowed.find((origin) => {
      try {
        return new URL(origin).host.toLowerCase() === host.toLowerCase();
      } catch {
        return false;
      }
    });
    if (match) return match;
  }

  // Nothing configured: derive from the request. This is the local development
  // path — with no allow-list there is nothing to check against, and no
  // deployment should be running without NEXT_PUBLIC_APP_URL set.
  if (allowed.length === 0) {
    const fallbackHost = host ?? "localhost:9002";
    const protocol =
      fallbackHost.startsWith("localhost") || fallbackHost.startsWith("127.")
        ? "http"
        : "https";
    return `${protocol}://${fallbackHost}`;
  }

  // Configured, but this request arrived on a host that is not on the list.
  // Send them to the canonical origin rather than to whatever the Host header
  // claimed.
  return allowed[0];
}

/**
 * Register with name, email and password.
 *
 * `name` is passed as user metadata so the profile trigger can pick it up. It
 * is display data only — nothing authorizes off it.
 */
export async function signUpWithPassword(formData: FormData): Promise<AuthActionResult> {
  const parsed = Registration.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details you entered" };
  }

  const supabase = await createClient();
  const origin = await originFromRequest();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
      emailRedirectTo: `${origin}/auth/confirm?next=/profile`,
    },
  });

  if (error) {
    // Deliberately not distinguishing "already registered" from other
    // failures: doing so tells an attacker which addresses have accounts.
    console.error("[auth] Sign-up failed:", error.message);
    return { error: "Could not create that account. Try again, or sign in instead." };
  }

  redirect("/login?checkEmail=1");
}

export async function signInWithPassword(formData: FormData): Promise<AuthActionResult> {
  const parsed = Credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter your email address and password" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // One message for both a wrong password and an unknown address, so this
    // cannot be used to enumerate accounts.
    return { error: "That email address and password do not match an account." };
  }

  const next = safeInternalPath(formData.get("next")?.toString());
  revalidatePath("/", "layout");
  redirect(next);
}

export async function signInWithGoogle(formData: FormData): Promise<AuthActionResult> {
  const supabase = await createClient();
  const origin = await originFromRequest();
  const next = safeInternalPath(formData.get("next")?.toString());

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data?.url) {
    console.error("[auth] Could not start Google sign-in:", error?.message);
    return { error: "Could not reach Google right now. Try again in a moment." };
  }

  redirect(data.url);
}

export async function requestPasswordReset(formData: FormData): Promise<AuthActionResult> {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(320)
    .safeParse(formData.get("email"));

  if (!email.success) {
    return { error: "Enter a valid email address" };
  }

  const supabase = await createClient();
  const origin = await originFromRequest();

  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/confirm?type=recovery&next=/settings`,
  });

  // Always the same answer, whether or not the address is registered.
  return {};
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
