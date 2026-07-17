"use server";

import { revalidatePath } from "next/cache";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";
import type { User as UserType } from "@/lib/types";

export async function updateUserDisplayName(
  uid: string,
  newName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!uid || !newName) {
    return { success: false, error: "User ID and new name are required." };
  }

  try {
    await connectToDatabase();
    await User.findOneAndUpdate(
      { uid },
      { $set: { name: newName } },
      { upsert: true },
    );
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

  try {
    await connectToDatabase();
    const update: any = { wallet: walletStatus };
    if (walletStatus === "disconnected") {
      update.stellarPublicKey = "";
    }
    await User.findOneAndUpdate(
      { uid },
      { $set: update },
      { upsert: true },
    );
    return { success: true };
  } catch (error) {
    console.error("Failed to update wallet status:", error);
    return { success: false, error: "Could not update wallet status." };
  }
}