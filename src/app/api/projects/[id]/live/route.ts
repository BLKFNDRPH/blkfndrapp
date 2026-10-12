import { NextRequest, NextResponse } from "next/server";
import { getProjectById } from "@/lib/data/projects";
import { readVaultStateCached } from "@/lib/vault-state";
import { callerIsSignedIn } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * A project's live vault figures (state, money, stages), read from the ledger
 * by this server so browsers no longer call the public RPC for them.
 *
 * Served from a few seconds' cache. `?fresh=1` reads again, for a signed-in
 * caller refreshing after their own stake or vote; anyone else gets the
 * cache, so the parameter cannot be used to push reads through to the RPC.
 * A project hidden from the caller answers 404, as /api/projects/[id] does.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProjectById(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!project.vaultAddress) {
      return NextResponse.json({ error: "This project has no vault" }, { status: 404 });
    }

    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" && (await callerIsSignedIn());
    const state = await readVaultStateCached(project.vaultAddress, { fresh });
    if (!state) {
      return NextResponse.json({ error: "The vault could not be read" }, { status: 502 });
    }
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error reading a project's vault:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
