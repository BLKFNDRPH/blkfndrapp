import { NextResponse } from "next/server";
import { getOwnDecisions } from "@/lib/data/decisions";
import { AuthError } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/** What needs the signed-in person now: open votes they haven't cast, money waiting. */
export async function GET() {
  try {
    return NextResponse.json(await getOwnDecisions());
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("decisions GET:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
