import { NextRequest, NextResponse } from "next/server";
import { getRiskReportByHash } from "@/lib/data/risk-reports";

export const dynamic = "force-dynamic";

/**
 * One risk report, by its SHA-256. The body is the report's canonical bytes,
 * exactly as hashed and anchored, so `sha256sum` of the response equals the
 * hash in the URL. Where it was anchored is in the X-Report-Anchor-* headers.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ hash: string }> }) {
  try {
    const { hash } = await context.params;
    const report = await getRiskReportByHash(hash.toLowerCase());
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "x-report-hash": report.hash,
    };
    if (report.anchor) {
      headers["x-report-anchor-contract"] = report.anchor.contract;
      headers["x-report-anchor-seq"] = String(report.anchor.seq);
      headers["x-report-anchor-tx"] = report.anchor.tx;
    }
    return new NextResponse(report.json, { status: 200, headers });
  } catch (error) {
    console.error("Error reading a risk report:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
