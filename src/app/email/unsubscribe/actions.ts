"use server";

import { unsubscribeByToken } from "@/lib/data/email-preferences";

/**
 * Turn one kind of email off from the link in an email. No session: the
 * unsubscribe token in the link is the authority, and it can only turn a
 * switch off, never on.
 */
export async function unsubscribeFromEmail(
  token: string,
  category: string,
): Promise<{ success: true } | { success: false; error: "invalid" | "failed" }> {
  try {
    const done = await unsubscribeByToken(String(token ?? ""), String(category ?? ""));
    return done ? { success: true } : { success: false, error: "invalid" };
  } catch (error) {
    console.error("[email-unsubscribe] Could not unsubscribe:", error);
    return { success: false, error: "failed" };
  }
}
