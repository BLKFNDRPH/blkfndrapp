"use server";

import { z } from "zod";
import {
  setProjectHidden,
  setProjectLocked,
  getRestriction,
  isVaultLocked,
} from "@/lib/data/project-restrictions";
import { authFailure } from "@/lib/auth/guards";

/**
 * Hide and lock. Every exported function here is a public HTTP endpoint, so the
 * inputs are checked for shape; authorization is not added here at all — it is
 * set_project_hidden / set_project_locked in Postgres, reached through the
 * caller's own session, and a caller who skipped these wrappers would meet the
 * same refusal.
 */

const vaultSchema = z.string().trim().min(1).max(64);
const reasonSchema = z.string().max(2000).optional();

function fail(error: unknown, fallback: string) {
  return (
    authFailure(error) ?? {
      success: false as const,
      error: error instanceof Error ? error.message : fallback,
    }
  );
}

export async function setProjectHiddenAction(
  vaultAddress: string,
  hidden: boolean,
  reason?: string,
) {
  try {
    const vault = vaultSchema.parse(vaultAddress);
    await setProjectHidden(vault, z.boolean().parse(hidden), reasonSchema.parse(reason) ?? "");
    return { success: true as const, restriction: await getRestriction(vault) };
  } catch (error) {
    return fail(error, hidden ? "Could not hide the project." : "Could not unhide the project.");
  }
}

export async function setProjectLockedAction(
  vaultAddress: string,
  locked: boolean,
  reason?: string,
) {
  try {
    const vault = vaultSchema.parse(vaultAddress);
    await setProjectLocked(vault, z.boolean().parse(locked), reasonSchema.parse(reason) ?? "");
    return { success: true as const, restriction: await getRestriction(vault) };
  } catch (error) {
    return fail(error, locked ? "Could not lock the project." : "Could not unlock the project.");
  }
}

/**
 * The lock, asked fresh before the interface builds a stake or opens a vote.
 * `locked: null` means the question could not be answered.
 */
export async function checkVaultLockAction(vaultAddress: string) {
  const parsed = vaultSchema.safeParse(vaultAddress);
  if (!parsed.success) return { locked: null };
  return { locked: await isVaultLocked(parsed.data) };
}
