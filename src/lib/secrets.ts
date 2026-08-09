import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Read a platform integration secret, server-side only.
 *
 * The value lives in Supabase Vault and is reachable by exactly one thing: the
 * service-role key this server holds. A browser session — even an owner's —
 * cannot read it; owners write secrets and never see them back. So this must
 * never be imported into a client component, which "server-only" enforces at
 * build.
 *
 * Falls back to the process environment when the Vault has no value yet. That is
 * the migration path: a deploy still carrying PINATA_JWT in its env keeps
 * working, and moving the secret into the Vault is a change an owner can make
 * from the console without a redeploy. Once set in the Vault, the Vault wins.
 */
const ENV_FALLBACK: Record<string, string | undefined> = {
  pinata_jwt: process.env.PINATA_JWT,
  resend_api_key: process.env.RESEND_API_KEY,
};

export async function getSecret(
  name: "pinata_jwt" | "resend_api_key",
): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_platform_secret", {
      secret_name: name,
    });
    if (!error && typeof data === "string" && data.length > 0) {
      return data;
    }
  } catch {
    // A Vault miss or an unreachable database should not take down a feature
    // whose secret is still sitting in the environment. Fall through.
  }
  return ENV_FALLBACK[name] ?? null;
}
