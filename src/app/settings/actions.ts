"use server";

import { revalidatePath } from "next/cache";
import { updateOwnProfile } from "@/lib/data/profiles";
import { authFailure } from "@/lib/auth/guards";

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
