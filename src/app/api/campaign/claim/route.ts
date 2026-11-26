import { NextResponse } from "next/server";
import { requireCaller, AuthError } from "@/lib/supabase/auth";
import { claimPracticeUsdc } from "@/lib/campaign/usdc-claim";
import { CLAIM_MESSAGES, type ClaimRefusal } from "@/lib/campaign/claim-rules";

export const dynamic = "force-dynamic";

/** HTTP status for each refusal. None is 401/403: the caller is who they say. */
const STATUS: Record<ClaimRefusal, number> = {
  mainnet: 404,
  "campaign-closed": 503,
  "not-configured": 503,
  "no-wallet": 409,
  "already-claimed": 409,
  "no-account": 409,
  "no-trustline": 409,
  "daily-cap": 429,
  unavailable: 503,
  "payment-failed": 502,
  "payment-pending": 202,
};

/**
 * Claim the campaign's practice USDC: a fixed amount of Testnet USDC, paid to
 * the caller's own linked wallet, once per account and per wallet.
 *
 * The request carries nothing. The recipient is read from the caller's profile
 * on the server, so this can only ever pay the person asking, at the wallet
 * they proved they control when they linked it.
 */
export async function POST() {
  try {
    const caller = await requireCaller();
    const result = await claimPracticeUsdc(caller.userId);

    if (result.ok) {
      return NextResponse.json({ ok: true, txHash: result.txHash, amount: result.amount });
    }
    return NextResponse.json(
      { ok: false, code: result.code, error: CLAIM_MESSAGES[result.code] },
      { status: STATUS[result.code] },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("campaign/claim:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
