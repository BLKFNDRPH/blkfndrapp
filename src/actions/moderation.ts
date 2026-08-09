"use server";

import {
  listUsers,
  banUser,
  unbanUser,
  getHealth,
} from "@/lib/data/moderation";
import { authFailure } from "@/lib/auth/guards";

/**
 * Platform-administrator actions. Authorization is the database's: every one of
 * these runs requirePlatformAdmin and writes through RLS gated on the same role,
 * so a caller who reached the action id directly still writes nothing.
 */

function fail(error: unknown, fallback: string) {
  return (
    authFailure(error) ?? {
      success: false as const,
      error: error instanceof Error ? error.message : fallback,
    }
  );
}

export async function getUsersAction() {
  try {
    return { success: true as const, users: await listUsers() };
  } catch (error) {
    return fail(error, "Could not load users.");
  }
}

export async function banUserAction(userId: string, reason: string) {
  try {
    await banUser(userId, reason);
    return { success: true as const, users: await listUsers() };
  } catch (error) {
    return fail(error, "Could not ban the user.");
  }
}

export async function unbanUserAction(userId: string) {
  try {
    await unbanUser(userId);
    return { success: true as const, users: await listUsers() };
  } catch (error) {
    return fail(error, "Could not lift the ban.");
  }
}

export async function getHealthAction() {
  try {
    return { success: true as const, health: await getHealth() };
  } catch (error) {
    return fail(error, "Could not read platform health.");
  }
}
