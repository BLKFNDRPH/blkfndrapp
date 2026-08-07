import { NextRequest, NextResponse } from "next/server";
import { getProfileByAddress } from "@/lib/data/profiles";
import { AuthError } from "@/lib/supabase/auth";

// Maps a Stellar address to a platform identity. Signed-in callers only —
// anonymous access made this a deanonymisation oracle, since contributor
// addresses are public on the ledger.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const profile = await getProfileByAddress(address);
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("user-by-address:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
