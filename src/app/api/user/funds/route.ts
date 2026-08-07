import { NextRequest, NextResponse } from "next/server";
import { getContributionsByAddress, getAllContributions } from "@/lib/data/events";
import { requireCaller, AuthError } from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";

export const dynamic = "force-dynamic";

// Contribution receipts derive from public ledger events, so this is not secret
// — but the no-address form returns every receipt on the platform, which is not
// something anonymous callers should be able to scrape on demand.
export async function GET(req: NextRequest) {
  try {
    await requireCaller();

    const address = req.nextUrl.searchParams.get("address");
    if (address && !isStellarAccount(address)) {
      return NextResponse.json({ error: "Invalid address format" }, { status: 400 });
    }

    const rows = address
      ? await getContributionsByAddress(address)
      : await getAllContributions();

    // Event payload is [project_id, contributor, amount, raised_total].
    return NextResponse.json(
      rows.map((row) => {
        const p = Array.isArray(row.payload) ? row.payload : [];
        return {
          fund_id: row.event_id,
          project_id: String(p[0] ?? ""),
          contributor: String(p[1] ?? ""),
          amount: String(p[2] ?? "0"),
          usdc_amount: String(p[2] ?? "0"),
          share_percentage: "0",
          fee_paid: "0",
          fund_date: row.ledger_closed_at ? new Date(row.ledger_closed_at).getTime() : 0,
          vault_address: row.contract_id,
        };
      }),
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("user/funds:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
