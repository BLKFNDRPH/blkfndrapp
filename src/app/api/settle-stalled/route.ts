import { NextRequest, NextResponse } from "next/server";
import { triggerSettleStalled } from "@/lib/settle-stalled";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * The abandoned-vault reclaim trigger, called on a schedule.
 *
 * settle_stalled on each vault is permissionless and self-gated (it reverts
 * unless the vault has been abandoned past its stall window), so this can be hit
 * as often as the scheduler likes — daily is fine — and it only moves the vaults
 * that are genuinely due. Same bearer-secret gate as the indexer and
 * ops-funding, since it is the same kind of caller: a cron, not a person.
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
    const result = await triggerSettleStalled();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error in settle-stalled route:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
