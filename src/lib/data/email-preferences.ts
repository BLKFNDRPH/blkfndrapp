import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller } from "@/lib/supabase/auth";
import {
  DEFAULT_EMAIL_PREFERENCES,
  EMAIL_SWITCHES,
  isEmailSwitch,
  type EmailPreferences,
  type EmailSwitch,
} from "@/lib/email/categories";

/**
 * Which emails each person wants. email_preferences has RLS with no policies
 * and no browser grants, so everything here goes through the service role, and
 * the gate is this code: the session for your own switches, the unsubscribe
 * token for a link in an email.
 */

type Admin = ReturnType<typeof createAdminClient>;

const switchPatch = (sw: EmailSwitch, on: boolean) => ({ [sw]: on }) as Partial<EmailPreferences>;

function pick(row: Partial<Record<EmailSwitch, unknown>> | null | undefined): EmailPreferences {
  const out = { ...DEFAULT_EMAIL_PREFERENCES };
  for (const sw of EMAIL_SWITCHES) {
    if (typeof row?.[sw] === "boolean") out[sw] = row[sw] as boolean;
  }
  return out;
}

export interface OwnEmailSettings {
  /** Where emails go: the account's sign-in address. */
  email: string | null;
  preferences: EmailPreferences;
  /** On the admin roster, so the "reviews" switch applies to them. */
  isAdmin: boolean;
}

export async function getOwnEmailSettings(): Promise<OwnEmailSettings> {
  const caller = await requireCaller();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_preferences")
    .select(EMAIL_SWITCHES.join(", "))
    .eq("user_id", caller.userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your email settings: ${error.message}`);
  return {
    email: caller.email,
    preferences: pick(data as Partial<Record<EmailSwitch, unknown>> | null),
    isAdmin: caller.isAdmin,
  };
}

export async function setOwnEmailPreference(sw: EmailSwitch, on: boolean): Promise<EmailPreferences> {
  const caller = await requireCaller();
  if (!isEmailSwitch(sw)) throw new Error("Unknown email setting.");
  const admin = createAdminClient();
  // Only the one column is in the payload, so an existing row keeps its other
  // switches and its unsubscribe token.
  const { data, error } = await admin
    .from("email_preferences")
    .upsert({ user_id: caller.userId, ...switchPatch(sw, Boolean(on)) }, { onConflict: "user_id" })
    .select(EMAIL_SWITCHES.join(", "))
    .single();
  if (error) throw new Error(`Could not save your email settings: ${error.message}`);
  return pick(data as Partial<Record<EmailSwitch, unknown>>);
}

/**
 * Turn one kind of email off from a link in an email, without signing in.
 * True if the token matched someone.
 */
export async function unsubscribeByToken(token: string, sw: string): Promise<boolean> {
  const parsedToken = z.string().uuid().safeParse(token);
  if (!parsedToken.success || !isEmailSwitch(sw)) return false;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_preferences")
    .update(switchPatch(sw, false))
    .eq("unsubscribe_token", parsedToken.data)
    .select("user_id");
  if (error) throw new Error(`Could not update email settings: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Preferences and unsubscribe tokens for the people about to be emailed. Anyone
 * without a row gets one with every switch on (the default), so their email
 * can carry a token.
 */
export async function preferencesFor(
  admin: Admin,
  userIds: string[],
  options: { create: boolean },
): Promise<Map<string, EmailPreferences & { token: string | null }>> {
  const out = new Map<string, EmailPreferences & { token: string | null }>();
  if (userIds.length === 0) return out;
  const columns = `user_id, unsubscribe_token, ${EMAIL_SWITCHES.join(", ")}`;

  const read = async () => {
    const { data, error } = await admin.from("email_preferences").select(columns).in("user_id", userIds);
    if (error) throw new Error(`Could not read email preferences: ${error.message}`);
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      out.set(String(row.user_id), { ...pick(row), token: String(row.unsubscribe_token) });
    }
  };

  await read();
  const missing = userIds.filter((id) => !out.has(id));
  if (missing.length > 0 && options.create) {
    const { error } = await admin
      .from("email_preferences")
      .upsert(
        missing.map((user_id) => ({ user_id })),
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(`Could not create email preferences: ${error.message}`);
    await read();
  }
  for (const id of userIds) {
    if (!out.has(id)) out.set(id, { ...DEFAULT_EMAIL_PREFERENCES, token: null });
  }
  return out;
}
