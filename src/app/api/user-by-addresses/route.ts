import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import UserModel from "@/lib/models/User";
import { getSession } from "@/lib/auth/session";

// Batch form of /api/user-by-address. Same reasoning: signed-in callers only,
// and no `role` in the payload.
const MAX_ADDRESSES = 200;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { addresses } = await req.json();

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({});
    }

    const wanted = addresses
      .filter((a): a is string => typeof a === "string")
      .slice(0, MAX_ADDRESSES);

    if (wanted.length === 0) {
      return NextResponse.json({});
    }

    await connectToDatabase();

    const users = await UserModel.find({
      stellarPublicKey: { $in: wanted },
    })
      .select("uid name creatorAvatar stellarPublicKey")
      .lean();

    const userMap: Record<string, any> = {};
    for (const user of users) {
      if (!user.stellarPublicKey) continue;
      userMap[user.stellarPublicKey] = {
        uid: user.uid,
        name: user.name,
        creatorAvatar: user.creatorAvatar,
        stellarPublicKey: user.stellarPublicKey,
      };
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
