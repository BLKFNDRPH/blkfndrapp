import { NextRequest, NextResponse } from "next/server";
import { runKeepAlive } from "@/lib/ttl-keeper";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Keeps the platform's shared contract storage from expiring, called on a
 * schedule. Restoring and extending are permissionless and cost only fees, so
 * this can run daily: it pays only for the entries that are actually due and
 * returns at once otherwise. Same bearer-secret gate as the indexer,
 * ops-funding and settle-stalled, since it is the same kind of caller -- a
 * cron, not a person.
 *
 * `{"dryRun": true}` reports what is due and its simulated cost, and sends
 * nothing.
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
    const result = await runKeepAlive({ dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error in keep-alive route:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
