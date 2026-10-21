import { NextRequest, NextResponse } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";
import { consumeWalletLinkChallenge } from "@/lib/data/platform";
import { linkWallet } from "@/lib/data/profiles";
import { requireCaller, AuthError } from "@/lib/supabase/auth";
import { walletLinkDigest } from "@/lib/wallet-link-message";
import { jsonObject } from "@/lib/json-body";
import { isStellarAccount } from "@/lib/stellar-address";

/**
 * Link a Stellar address to the signed-in account.
 *
 * Identity is Supabase's; this only proves control of a wallet. The challenge
 * must be one this account was issued, and is consumed before the signature is
 * checked, so a failed verification still burns it and cannot be retried. The
 * signature is checked against the stored message, the text that named this
 * site and this account, never against anything the request sends.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireCaller();

    const body = await jsonObject(req);
    const publicKey = body?.publicKey;
    const signature = body?.signature;
    const nonce = body?.nonce;
    if (
      !isStellarAccount(publicKey) ||
      !signature ||
      typeof nonce !== "string" ||
      !nonce
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const message = await consumeWalletLinkChallenge(caller.userId, publicKey, nonce);
    if (!message) {
      return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
    }

    const keypair = Keypair.fromPublicKey(publicKey);
    const sigBuffer = Array.isArray(signature)
      ? Buffer.from(signature)
      : Buffer.from(String(signature), "base64");

    if (!keypair.verify(walletLinkDigest(message), sigBuffer)) {
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
