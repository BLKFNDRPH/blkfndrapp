import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { issueChallenge } from "@/lib/data/platform";
import { requireCaller, AuthError } from "@/lib/supabase/auth";

// Issues the challenge a wallet signs to prove control before it is linked.
// Requires a session: linking attaches an address to *an account*, so there
// must be an account to attach it to.
export async function POST(req: NextRequest) {
  try {
    await requireCaller();

    const { publicKey } = await req.json();
    if (!publicKey) {
      return NextResponse.json({ error: "Public key is required" }, { status: 400 });
    }

    const nonce = crypto.randomBytes(32).toString("hex");
    await issueChallenge(publicKey, nonce);

    return NextResponse.json({ nonce });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Freighter] nonce:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
