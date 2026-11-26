import { NextRequest, NextResponse } from "next/server";
import { getRiskReportsForVault } from "@/lib/data/risk-reports";

export const dynamic = "force-dynamic";

/**
 * A vault's risk reports, newest first: `?vault=C…`. Each carries its hash,
 * score, band, the canonical report and, once anchored, where. The first is
 * the one the project page shows (item 2.1); the rest are the trail.
 */
export async function GET(req: NextRequest) {
  const vault = req.nextUrl.searchParams.get("vault") ?? "";
  try {
    const reports = await getRiskReportsForVault(vault);
    if (!reports) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({
      vault,
      reports: reports.map(({ json, ...rest }) => ({ ...rest, report: JSON.parse(json) })),
    });
  } catch (error) {
    console.error("Error reading risk reports:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
