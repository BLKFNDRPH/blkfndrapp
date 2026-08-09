import { NextRequest, NextResponse } from "next/server";
import { triggerOpsFunding } from "@/lib/ops-funding";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * The monthly operations-funding trigger, called on a schedule.
 *
 * fund_operations on the treasury is permissionless and gated to once every
 * thirty days, so this can be hit as often as the scheduler likes — daily is
 * fine — and it moves money at most once a month. Same bearer-secret gate as the
 * indexer, since it is the same kind of caller: a cron, not a person.
 */
function isAuthenticated(req: NextRequest): boolean {
  const secret = process.env.INDEXER_SECRET;
  if (!secret) {
    console.error("INDEXER_SECRET is not set — rejecting request.");
    return false;
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice("Bearer ".length);
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await triggerOpsFunding();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error in ops-funding route:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
