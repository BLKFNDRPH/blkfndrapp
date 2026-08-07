import { NextResponse } from "next/server";
import { unlinkWallet } from "@/lib/data/profiles";
import { AuthError } from "@/lib/supabase/auth";

export async function POST() {
  try {
    await unlinkWallet();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Freighter] disconnect:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
