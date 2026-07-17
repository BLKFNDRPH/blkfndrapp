import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import UserModel from "@/lib/models/User";

export async function POST(req: NextRequest) {
  try {
    const { addresses } = await req.json();

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({});
    }

    await connectToDatabase();

    const users = await UserModel.find({
      stellarPublicKey: { $in: addresses },
    }).lean();

    const userMap: Record<string, any> = {};
    for (const user of users) {
      const payload = {
        uid: user.uid,
        name: user.name,
        creatorAvatar: user.creatorAvatar,
        role: user.role,
        stellarPublicKey: user.stellarPublicKey,
      };
      if (user.stellarPublicKey)
        userMap[user.stellarPublicKey] = payload;
    }

    return NextResponse.json(userMap);
  } catch (error) {
    console.error("Error in batch user fetch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
