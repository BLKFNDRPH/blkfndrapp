import { NextRequest, NextResponse } from "next/server";
import { runIndexer } from "@/lib/event-indexer";
import crypto from "crypto";

export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runIndexer();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in indexer API route:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runIndexer();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in indexer API route:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
