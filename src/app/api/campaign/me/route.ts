import { NextResponse } from "next/server";
import { requireCaller, AuthError } from "@/lib/supabase/auth";
import { ensureReferralCode, referredCount } from "@/lib/campaign/referrals";
import { claimStatus } from "@/lib/campaign/usdc-claim";
import { referralLink } from "@/lib/campaign/referral-code";
import { publicOrigin } from "@/lib/auth/app-origin";

export const dynamic = "force-dynamic";

/**
 * The signed-in account's own campaign state: its referral link (the code is
 * made on first ask), how many sign-ups it has referred, and where its
 * practice-USDC claim stands. Only ever the caller's own.
 */
export async function GET() {
  try {
    const caller = await requireCaller();

    const [code, referred, claim] = await Promise.all([
      ensureReferralCode(caller.userId),
      referredCount(caller.userId),
      claimStatus(caller.userId),
    ]);

    return NextResponse.json({
      referral: { code, link: referralLink(await publicOrigin(), code), referred },
      claim,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("campaign/me:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
