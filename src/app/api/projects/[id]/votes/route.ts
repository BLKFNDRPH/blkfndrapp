import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { getProjectById } from "@/lib/data/projects";
import { readMyVotes, readVoteTallyCached } from "@/lib/vault-reads";
import { encodeVotePanel } from "@/lib/vote-panel";
import { callerIsSignedIn } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * The stage vote panel's figures, read from the vault by this server.
 *
 * The tally is the same for everyone and is served from a few seconds'
 * cache; `?fresh=1` reads it again for a signed-in caller, as after their own
 * vote. `?address=` adds that stakeholder's weight and votes, read every time.
 * A project hidden from the caller answers 404, as /api/projects/[id] does.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProjectById(id);
    if (!project?.vaultAddress) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const params = req.nextUrl.searchParams;
    const address = params.get("address") ?? "";
    if (
      address &&
      !StrKey.isValidEd25519PublicKey(address) &&
      !StrKey.isValidContract(address)
    ) {
      return NextResponse.json({ error: "Not a Stellar address" }, { status: 400 });
    }

    const fresh = params.get("fresh") === "1" && (await callerIsSignedIn());
    const tally = await readVoteTallyCached(project.vaultAddress, { fresh });
    if (!tally) {
      return NextResponse.json({ error: "The vault could not be read" }, { status: 502 });
    }

    const mine = address
      ? await readMyVotes(
          project.vaultAddress,
          address,
          tally.milestones.map((m) => m.id),
        )
      : null;

    return NextResponse.json(encodeVotePanel({ tally, mine }));
  } catch (error) {
    console.error("Error reading a project's votes:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
