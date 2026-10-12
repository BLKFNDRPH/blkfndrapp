import { NextRequest, NextResponse } from "next/server";
import { readPlatformCached } from "@/lib/platform-reads";
import { callerIsSignedIn } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * The platform's on-chain settings: admin roster, listing fee, deposit rate
 * and fee wallet. Read by this server and shared for a minute, rather than by
 * every browser from the public RPC. `?fresh=1` reads again for a signed-in
 * caller, such as an admin who has just changed one.
 */
export async function GET(req: NextRequest) {
  try {
    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" && (await callerIsSignedIn());
    const platform = await readPlatformCached({ fresh });
    if (!platform) {
      return NextResponse.json({ error: "The platform settings could not be read" }, { status: 502 });
    }
    return NextResponse.json(platform);
  } catch (error) {
    console.error("Error reading the platform settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
