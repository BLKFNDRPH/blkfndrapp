"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/auth/safe-redirect";
import { rememberNextPath } from "@/lib/auth/next-cookie";
import { publicOrigin } from "@/lib/auth/app-origin";

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
  const origin = await publicOrigin();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
      emailRedirectTo: `${origin}/auth/confirm`,
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
  const origin = await publicOrigin();
  // The destination travels in a short-lived cookie rather than on the URL.
  // Supabase matches its redirect allow-list as a glob against the whole URL,
  // so a query string forces a wildcard entry — and an entry that does not
  // match is not rejected, it silently redirects to the Site URL instead.
  await rememberNextPath(formData.get("next")?.toString());

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
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
  const origin = await publicOrigin();

  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/confirm`,
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
