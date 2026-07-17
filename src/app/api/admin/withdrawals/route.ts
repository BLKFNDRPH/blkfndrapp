import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";
import ClaimRequest from "@/lib/models/ClaimRequest";
import { getSession } from "@/lib/auth/session";
import { Client } from "@/packages/blkfndr_v2/src";
import { Networks } from "@stellar/stellar-sdk";
import { CONTRACT_ID, SOROBAN_RPC_URL } from "@/lib/stellar";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    // Verify user role is admin in database
    const userRecord = await User.findOne({ uid: session.user.uid }).lean();
    if (!userRecord || userRecord.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1. Get count of unresolved claim requests in database
    const dbClaimCount = await ClaimRequest.countDocuments();

    // 2. Get count of active proposals on-chain
    let pendingProposalsCount = 0;
    try {
      if (CONTRACT_ID) {
        const client = new Client({
          contractId: CONTRACT_ID,
          rpcUrl: SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
          networkPassphrase: Networks.TESTNET,
        });

        const tx = await client.get_pending_proposals();
        const simulation = await tx.simulate();
        const proposals = simulation.result || [];
        pendingProposalsCount = proposals.filter((p: any) => !p.executed).length;
      }
    } catch (contractErr: any) {
      const errMsg = contractErr?.message || String(contractErr);
      console.warn(`[API Withdrawals] Failed to query contract pending proposals (expected if function is not deployed on contract ID): ${errMsg.split("\n")[0]}`);
    }

    return NextResponse.json({ count: dbClaimCount + pendingProposalsCount });
  } catch (error: any) {
    console.error("[API Withdrawals] Failed to fetch unresolved withdrawals:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
