import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireCaller } from "@/lib/supabase/auth";
import { jsonObject } from "@/lib/json-body";
import { SponsorRefusalError } from "@/lib/sponsor/policy";
import { sponsorTransaction } from "@/lib/sponsor/sponsor";

export const dynamic = "force-dynamic";

/**
 * Pay the network fee for the caller's own signed contract call.
 *
 * Body: { xdr } — the inner transaction, already signed by the caller's linked
 * wallet. Answers { hash, status, feeStroops } once the fee-bump is submitted,
 * or { code, error } with the refusal (see SPONSOR_REFUSALS in
 * src/lib/sponsor/policy.ts). Every refusal means "pay the fee yourself": the
 * client then submits the same signed transaction on its own, so sponsorship
 * can delay a stake or a vote but never block one. 503 "disabled" is the kill
 * switch.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireCaller();
    const body = await jsonObject(req);
    const xdr = body?.xdr;
    if (typeof xdr !== "string" || xdr.length === 0 || xdr.length > 20_000) {
      return NextResponse.json(
        { code: "bad_xdr", error: "Send the signed transaction as { xdr }." },
        { status: 400 },
      );
    }
    const result = await sponsorTransaction({ userId: caller.userId, innerXdr: xdr });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SponsorRefusalError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    }
    console.error("sponsor:", error);
    return NextResponse.json(
      { code: "unavailable", error: "Fee sponsorship is unavailable right now. Pay the fee from your wallet." },
      { status: 503 },
    );
  }
}
