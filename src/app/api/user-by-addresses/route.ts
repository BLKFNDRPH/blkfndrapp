import { NextRequest, NextResponse } from "next/server";
import { resolveAddresses } from "@/lib/data/profiles";
import { AuthError, requireCaller } from "@/lib/supabase/auth";
import { jsonObject } from "@/lib/json-body";

export async function POST(req: NextRequest) {
  try {
    await requireCaller();
    const addresses = (await jsonObject(req))?.addresses;
    if (!Array.isArray(addresses)) return NextResponse.json({});
    return NextResponse.json(await resolveAddresses(addresses));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("user-by-addresses:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
