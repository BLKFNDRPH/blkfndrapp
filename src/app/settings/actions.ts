"use server";

import { revalidatePath } from "next/cache";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { requireSelfOrAdmin, authFailure } from "@/lib/auth/guards";

export async function updateUserDisplayName(
  uid: string,
  newName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!uid || !newName) {
    return { success: false, error: "User ID and new name are required." };
  }

  try {
    await requireSelfOrAdmin(uid);
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  const trimmed = newName.trim();
  if (!trimmed || trimmed.length > 64) {
    return { success: false, error: "Name must be between 1 and 64 characters." };
  }

  try {
    await connectToDatabase();
    // No upsert: this only renames an account that already exists. Upserting
    // here let an unauthenticated caller mint arbitrary User documents.
    const updated = await User.findOneAndUpdate(
      { uid },
      { $set: { name: trimmed } },
      { new: true },
    );
    if (!updated) {
      return { success: false, error: "User not found." };
    }
    revalidatePath("/profile");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Failed to update display name:", error);
    return { success: false, error: "Could not update display name." };
  }
}

export async function updateUserWalletStatus(
  uid: string,
  walletStatus: "connected" | "disconnected",
): Promise<{ success: boolean; error?: string }> {
  if (!uid) {
    return { success: false, error: "User ID is required." };
  }

  if (walletStatus !== "connected" && walletStatus !== "disconnected") {
    return { success: false, error: "Invalid wallet status." };
  }

  try {
    await requireSelfOrAdmin(uid);
  } catch (error) {
    return authFailure(error) ?? { success: false, error: "Unauthorized" };
  }

  try {
    await connectToDatabase();
    const update: Record<string, unknown> = { wallet: walletStatus };
    if (walletStatus === "disconnected") {
      update.stellarPublicKey = "";
    }
    const updated = await User.findOneAndUpdate(
      { uid },
      { $set: update },
      { new: true },
    );
    if (!updated) {
      return { success: false, error: "User not found." };
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to update wallet status:", error);
    return { success: false, error: "Could not update wallet status." };
  }
}
