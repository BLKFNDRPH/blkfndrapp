import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import PlatformSettings from "@/lib/models/PlatformSettings";
import User from "@/lib/models/User";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne().lean();
    if (!settings) {
      // Initialize settings with defaults if not present
      const defaultSettings = await PlatformSettings.create({
        feeWalletEmail: "admin@blkfndr.com",
      });
      return NextResponse.json({ feeWalletEmail: defaultSettings.feeWalletEmail });
    }
    return NextResponse.json({ feeWalletEmail: settings.feeWalletEmail });
  } catch (error) {
    console.error("[API] Failed to get platform settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { checkIsAdminOnChain } from "@/lib/stellar";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      console.error("[platform-settings] POST rejected: no session found");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    // Verify admin role in database
    const userRecord = await User.findOne({ uid: session.user.uid }).lean();
    if (!userRecord) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let isAuthorized = false;

    // Verify user on-chain admin status using their linked Freighter wallet
    if (userRecord.stellarPublicKey) {
      const isOnChain = await checkIsAdminOnChain(userRecord.stellarPublicKey);
      if (isOnChain) {
        isAuthorized = true;
        if (userRecord.role !== "admin") {
          // Promote user to admin in DB
          await User.updateOne({ uid: session.user.uid }, { $set: { role: "admin" } });
          console.log(`[platform-settings] User ${session.user.uid} promoted to admin in DB based on linked wallet ${userRecord.stellarPublicKey}`);
        }
      } else {
        if (userRecord.role === "admin") {
          // Demote user to user in DB
          await User.updateOne({ uid: session.user.uid }, { $set: { role: "user" } });
          console.log(`[platform-settings] User ${session.user.uid} demoted to user in DB based on linked wallet ${userRecord.stellarPublicKey}`);
        }
      }
    }

    if (!isAuthorized) {
      console.error(
        `[platform-settings] POST rejected: uid=${session.user.uid}, role=${userRecord.role}, wallet=${userRecord.stellarPublicKey ?? "NONE"}`
      );
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { feeWalletEmail } = await req.json();
    if (!feeWalletEmail || !feeWalletEmail.includes("@")) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const settings = await PlatformSettings.findOneAndUpdate(
      {},
      { $set: { feeWalletEmail } },
      { upsert: true, new: true }
    );

    console.log("[platform-settings] POST success: saved email =", feeWalletEmail);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error("[API] Failed to update platform settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
