"use server";

import { revalidatePath } from "next/cache";
import { updateOwnProfile } from "@/lib/data/profiles";
import { authFailure } from "@/lib/auth/guards";
import { getOwnEmailSettings, setOwnEmailPreference, type OwnEmailSettings } from "@/lib/data/email-preferences";
import type { EmailPreferences, EmailSwitch } from "@/lib/email/categories";

/**
 * Update the caller's own display name.
 *
 * No `uid` parameter: the previous signature took one and had no auth check at
 * all, so any anonymous caller could rename any user. Identity now comes from
 * the session and RLS confines the write, so there is nothing to pass and
 * nothing to forge.
 */
export async function updateUserDisplayName(
  newName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateOwnProfile({ displayName: newName });
    revalidatePath("/profile");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false,
        error: error instanceof Error ? error.message : "Could not update display name.",
      }
    );
  }
}

/** The caller's email switches, and the address emails go to. */
export async function getMyEmailSettings(): Promise<
  { success: true; settings: OwnEmailSettings } | { success: false; error: string; signedOut?: boolean }
> {
  try {
    return { success: true, settings: await getOwnEmailSettings() };
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return { ...auth, signedOut: true };
    return { success: false, error: "We couldn't load your email settings. Try again in a moment." };
  }
}

/** Turn one of the caller's own email switches on or off. */
export async function setMyEmailPreference(
  sw: EmailSwitch,
  on: boolean,
): Promise<{ success: true; preferences: EmailPreferences } | { success: false; error: string }> {
  try {
    return { success: true, preferences: await setOwnEmailPreference(sw, on) };
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "We couldn't save that. Try again." };
  }
}
