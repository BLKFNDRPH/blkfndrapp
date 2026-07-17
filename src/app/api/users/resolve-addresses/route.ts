import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";

export async function POST(req: NextRequest) {
  try {
    const { addresses } = await req.json();
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({ users: {} });
    }

    await connectToDatabase();

    const users = await User.find({
      stellarPublicKey: { $in: addresses },
    })
      .select("name creatorAvatar stellarPublicKey")
      .lean();

    // Build a map: address -> { name, avatarUrl }
    const userMap: Record<string, { name: string; avatarUrl: string | undefined }> = {};
    for (const u of users) {
      const info = { name: u.name, avatarUrl: (u as any).creatorAvatar as string | undefined };
      
      if (u.stellarPublicKey && u.stellarPublicKey !== "0") {
        userMap[u.stellarPublicKey] = info;
      }
    }

    return NextResponse.json({ users: userMap });
  } catch (error) {
    console.error("resolve-addresses error:", error);
    return NextResponse.json({ users: {} }, { status: 500 });
  }
}