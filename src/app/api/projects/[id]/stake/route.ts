import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { getProjectById } from "@/lib/data/projects";
import { readContributorBalance } from "@/lib/vault-reads";

export const dynamic = "force-dynamic";

/**
 * One stakeholder's balance in a project's vault: `?address=G…`. Read by this
 * server, as the vote panel's figures are, so the project page no longer
 * loads the Stellar SDK to ask. Never cached. A project hidden from the
 * caller answers 404, as /api/projects/[id] does.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const address = req.nextUrl.searchParams.get("address") ?? "";
    if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
      return NextResponse.json({ error: "Not a Stellar address" }, { status: 400 });
    }
    const project = await getProjectById(id);
    if (!project?.vaultAddress) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const balance = await readContributorBalance(project.vaultAddress, address);
    if (balance === null) {
      return NextResponse.json({ error: "The vault could not be read" }, { status: 502 });
    }
    return NextResponse.json({ balance: balance.toString() });
  } catch (error) {
    console.error("Error reading a stakeholder's balance:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
