import { NextRequest, NextResponse } from "next/server";
import { getVaultRecord } from "@/lib/data/vault-record";

export const dynamic = "force-dynamic";

/**
 * A project's public record: what its vault has done, from the indexed ledger
 * events. Readable by anyone who can see the project; a project hidden from
 * the caller answers 404, exactly as /api/projects/[id] does.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const record = await getVaultRecord(id);
    if (!record) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (error) {
    console.error("Error reading a project's record:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
