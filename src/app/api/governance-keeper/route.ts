import { NextRequest, NextResponse } from "next/server";
import { runGovernanceKeeper } from "@/lib/governance-keeper";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Sends approved payouts, closes stages whose vote ended short, and records
 * missed goals, called on a schedule. Every call it makes is permissionless and
 * gated by the vault, and a run with nothing due sends nothing, so it can poll
 * often. Same bearer-secret gate as the indexer, ops-funding, settle-stalled
 * and keep-alive, since it is the same kind of caller -- a cron, not a person.
 *
 * `{"dryRun": true}` reports what is due and sends nothing.
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

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // No body: a normal scheduled run.
  }

  try {
    const result = await runGovernanceKeeper({ dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error in governance-keeper route:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
