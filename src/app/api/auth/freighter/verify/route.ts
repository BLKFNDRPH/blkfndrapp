import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { consumeChallenge } from "@/lib/data/platform";
import { linkWallet } from "@/lib/data/profiles";
import { requireCaller, AuthError } from "@/lib/supabase/auth";

/**
 * Link a Stellar address to the signed-in account.
 *
 * Identity is Supabase's; this only proves control of a wallet. The challenge
 * is consumed before the signature is checked, so a failed verification still
 * burns the nonce and cannot be retried against the same one.
 */
export async function POST(req: NextRequest) {
  try {
    await requireCaller();

    const { publicKey, signature, nonce } = await req.json();
    if (!publicKey || !signature || !nonce) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const valid = await consumeChallenge(publicKey, nonce);
    if (!valid) {
      return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
    }

    const keypair = Keypair.fromPublicKey(publicKey);
    const sigBuffer = Array.isArray(signature)
      ? Buffer.from(signature)
      : Buffer.from(String(signature), "base64");

    const messageHash = crypto
      .createHash("sha256")
      .update("Stellar Signed Message:\n" + nonce, "utf8")
      .digest();

    if (!keypair.verify(messageHash, sigBuffer)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    await linkWallet(publicKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Freighter] verify:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
