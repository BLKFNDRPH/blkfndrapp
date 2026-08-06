import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import EventLog from "@/lib/models/EventLog";
import { addressMatcher } from "@/lib/stellar-address";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");
    const projectId = searchParams.get("projectId");
    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    // Validated and escaped before it reaches $regex: an arbitrary caller
    // string here is both a wildcard ("​.*" matches every row) and a
    // catastrophic-backtracking DoS against the whole collection.
    const matcher = addressMatcher(address);
    if (!matcher) {
      return NextResponse.json({ error: "Invalid address format" }, { status: 400 });
    }

    await connectToDatabase();

    // Find all deposit contribution logs for this user address
    const logs = await EventLog.find({
      topic1: "DEPOSIT",
      topic2: "CONTRIB",
      data: { $regex: matcher }
    });

    const contributedVaults = Array.from(new Set(logs.map((l) => l.contractId)));

    let hasContributed = false;
    if (projectId) {
      hasContributed = logs.some((log) => {
        try {
          const parsed = JSON.parse(log.data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return String(parsed[0]) === String(projectId);
          }
        } catch (e) {}
        return false;
      });
    }

    return NextResponse.json({ success: true, contributedVaults, hasContributed });
  } catch (error: any) {
    console.error("Error in GET /api/user/contributions:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
