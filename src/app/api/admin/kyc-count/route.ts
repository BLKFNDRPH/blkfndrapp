import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";
import KycRequest from "@/lib/models/KycRequest";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    // Verify user role is admin in database
    const userRecord = await User.findOne({ uid: session.user.uid }).lean();
    if (!userRecord || userRecord.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get count of pending KYC requests
    const pendingKycCount = await KycRequest.countDocuments({ status: "pending" });

    return NextResponse.json({ count: pendingKycCount });
  } catch (error: any) {
    console.error("[API KYC Count] Failed to fetch pending KYC count:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
