import { NextRequest, NextResponse } from "next/server";
import { getContributionsByAddress } from "@/lib/data/events";
import { requireCaller, AuthError } from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireCaller();

    const address = req.nextUrl.searchParams.get("address");
    const projectId = req.nextUrl.searchParams.get("projectId");

    if (!address || !isStellarAccount(address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    // An indexed jsonb query. The Mongo version matched the address with a
    // regex over serialised payloads, which scanned the whole collection and
    // let chain-supplied text reach the pattern.
    const rows = await getContributionsByAddress(address);

    const contributedVaults = Array.from(new Set(rows.map((r) => r.contract_id)));
    const hasContributed = projectId
      ? rows.some((r) => Array.isArray(r.payload) && String(r.payload[0]) === projectId)
      : false;

    return NextResponse.json({ success: true, contributedVaults, hasContributed });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("user/contributions:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
