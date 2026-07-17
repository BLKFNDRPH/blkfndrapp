import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import AuthChallenge from "@/lib/models/AuthChallenge";

export async function POST(req: NextRequest) {
  try {
    const { publicKey } = await req.json();

    if (!publicKey) {
      return NextResponse.json(
        { error: "Public key is required" },
        { status: 400 }
      );
    }

    try {
      await connectToDatabase();
    } catch (dbError) {
      console.error("[Freighter Auth] Database connection failed:", dbError);
      return NextResponse.json(
        {
          error:
            "Authentication service is unavailable right now. Check your MONGODB_URI and ensure your MongoDB Atlas IP whitelist includes this machine.",
        },
        { status: 503 },
      );
    }

    // Generate a random 32-byte nonce
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Upsert the challenge for this public key
    await AuthChallenge.findOneAndUpdate(
      { publicKey },
      { nonce, createdAt: new Date() },
      { upsert: true, new: true }
    );

    return NextResponse.json({ nonce });
  } catch (error) {
    console.error("[Freighter Auth] Error generating nonce:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
