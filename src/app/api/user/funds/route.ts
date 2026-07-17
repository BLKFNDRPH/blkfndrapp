import { NextRequest, NextResponse } from "next/server";
import { getUserFundsFromDb, getAllFundReceiptsFromDb } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
