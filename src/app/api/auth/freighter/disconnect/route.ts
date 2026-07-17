import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { getSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session?.user) {
      await connectToDatabase();
      await User.findOneAndUpdate(
        { uid: session.user.uid },
        {
          $set: {
            stellarPublicKey: "",
            wallet: "disconnected",
          },
        }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Freighter Disconnect] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
