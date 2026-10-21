import { NextRequest, NextResponse } from "next/server";
import { issueWalletLinkChallenge } from "@/lib/data/platform";
import { publicOrigin } from "@/lib/auth/app-origin";
import { requireCaller, AuthError } from "@/lib/supabase/auth";
import { jsonObject } from "@/lib/json-body";
import { isStellarAccount } from "@/lib/stellar-address";

// Issues the challenge a wallet signs to prove control before it is linked.
// Requires a session: linking attaches an address to *an account*, so there
// must be an account to attach it to, and the challenge is kept against it.
// The wallet signs `message`, which says which site and which account it is
// for; `nonce` comes back with the signature to find the challenge again.
export async function POST(req: NextRequest) {
  try {
    const caller = await requireCaller();

    const publicKey = (await jsonObject(req))?.publicKey;
    if (!publicKey) {
      return NextResponse.json({ error: "Public key is required" }, { status: 400 });
    }
    if (!isStellarAccount(publicKey)) {
      return NextResponse.json({ error: "Not a Stellar account address" }, { status: 400 });
    }

    const { nonce, message } = await issueWalletLinkChallenge({
      userId: caller.userId,
      account: caller.email ?? caller.userId,
      publicKey,
      // From configuration: publicOrigin only picks among configured origins,
      // so a forged Host header cannot put another site's name in the text.
      domain: new URL(await publicOrigin()).host,
    });

    return NextResponse.json({ nonce, message });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Freighter] nonce:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
