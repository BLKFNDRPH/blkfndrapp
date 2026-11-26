import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { runRiskPipeline } from "@/lib/risk/pipeline";

export const dynamic = "force-dynamic";
// One model call per changed vault; a first run over every listing is slow.
export const maxDuration = 800;

/**
 * Runs the risk pipeline: scores every listed vault whose inputs changed,
 * stores the reports, and anchors their hashes. Same bearer-secret gate as the
 * indexer and the keepers: the caller is a scheduler or an operator, not a
 * person in the app.
 *
 * Body, all optional: `{"dryRun": true}` scores and stores nothing;
 * `{"vault": "C…"}` runs one vault; `{"force": true}` writes a new report even
 * when nothing changed; `{"noAnchor": true}` stores without anchoring.
 */
function isAuthenticated(req: NextRequest): boolean {
  const secret = process.env.INDEXER_SECRET;
  if (!secret) {
    console.error("INDEXER_SECRET is not set — rejecting request.");
    return false;
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(authHeader.slice("Bearer ".length));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // No body: a normal scheduled run.
  }
  const vault = typeof body.vault === "string" ? body.vault : undefined;
  if (vault !== undefined && !/^C[A-Z2-7]{55}$/.test(vault)) {
    return NextResponse.json({ success: false, error: "vault must be a contract address" }, { status: 400 });
  }

  try {
    const result = await runRiskPipeline({
      dryRun: body.dryRun === true,
      force: body.force === true,
      noAnchor: body.noAnchor === true,
      vault,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error in risk-run route:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
