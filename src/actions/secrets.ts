"use server";

import { createClient } from "@/lib/supabase/server";
import { authFailure } from "@/lib/auth/guards";

/**
 * Managing platform integration secrets.
 *
 * Everything goes through the caller's own session, not the service role, so the
 * database evaluates is_owner() against the actual person — the owner-only rule
 * on set_platform_secret is the real boundary, and calling as the service role
 * would bypass exactly the check that matters. Reading a secret's value is not
 * offered here at all: only the server's own key can do that, and this file runs
 * on behalf of a browser.
 */

type SecretName = "pinata_jwt" | "resend_api_key";

function fail(error: unknown, fallback: string) {
  return (
    authFailure(error) ?? {
      success: false as const,
      error: error instanceof Error ? error.message : fallback,
    }
  );
}

export async function getSecretStatusAction() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("platform_secret_status");
    if (error) throw new Error(error.message);
    return { success: true as const, status: data ?? [] };
  } catch (error) {
    return fail(error, "Could not read the secret status.");
  }
}

export async function setPlatformSecretAction(name: SecretName, value: string) {
  try {
    if (!value.trim()) {
      return { success: false as const, error: "The value cannot be empty." };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_platform_secret", {
      secret_name: name,
      secret_value: value,
    });
    if (error) {
      // The database refuses a non-owner. Surfacing the code as a readable line
      // rather than a raw RLS string.
      if (error.code === "42501") {
        throw new Error("Only an owner can change platform secrets.");
      }
      throw new Error(error.message);
    }
    const status = await getSecretStatusAction();
    return { success: true as const, status: status.success ? status.status : [] };
  } catch (error) {
    return fail(error, "Could not save the secret.");
  }
}
