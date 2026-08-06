import { NextRequest, NextResponse } from "next/server";
import { getUserFundsFromDb, getAllFundReceiptsFromDb } from "@/lib/data";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Contribution receipts are derived from public ledger events, so this is not
// secret data — but the no-address branch dumps every receipt on the platform,
// which is not something anonymous callers should be able to scrape on demand.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");

    if (address) {
      if (!/^G[A-Z0-9]{55}$/.test(address)) {
        return NextResponse.json({ error: "Invalid address format" }, { status: 400 });
      }
      const investments = await getUserFundsFromDb(address);
      return NextResponse.json(investments);
    } else {
      const investments = await getAllFundReceiptsFromDb();
      return NextResponse.json(investments);
    }
  } catch (error: any) {
    console.error("Error in GET /api/user/funds:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
