import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, AuthError } from "@/lib/supabase/auth";

export async function GET() {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const { count } = await admin
      .from("kyc_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return NextResponse.json({ count: count ?? 0 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("kyc-count:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
