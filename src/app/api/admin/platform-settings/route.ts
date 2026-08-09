import { NextRequest, NextResponse } from "next/server";
import { getFeeWalletEmail, setFeeWalletEmail } from "@/lib/data/platform";
import { AuthError, requireAdmin } from "@/lib/supabase/auth";

const fail = (error: unknown, label: string) => {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`${label}:`, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
};

export async function GET() {
  try {
    return NextResponse.json({ feeWalletEmail: await getFeeWalletEmail() });
  } catch (error) {
    return fail(error, "platform-settings GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate before touching the request body, so an unauthenticated
    // caller is rejected cleanly (401) rather than reaching JSON.parse first.
    await requireAdmin();
    const { feeWalletEmail } = await req.json();
    await setFeeWalletEmail(feeWalletEmail);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, "platform-settings POST");
  }
}
