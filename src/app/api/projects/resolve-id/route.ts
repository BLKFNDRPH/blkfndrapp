import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import ProjectCache from "@/lib/models/ProjectCache";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";

export const dynamic = "force-dynamic";

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";


export async function POST(req: NextRequest) {
  try {
    const { vaultAddress } = await req.json();

    if (!vaultAddress || typeof vaultAddress !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid vaultAddress" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Find the project in the cache
    const project = await ProjectCache.findOne({ vaultAddress }).lean() as any;
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found for this vault address" },
        { status: 404 }
      );
    }

    // If the project already has a numeric ID, nothing to resolve
    if (/^\d+$/.test(project.projectId)) {
      return NextResponse.json({
        success: true,
        resolved: false,
        projectId: project.projectId,
        message: "Project already has a numeric ID",
      });
    }

    // Query the vault contract on-chain for the real project_id
    const client = new VaultClient({
      contractId: vaultAddress,
      rpcUrl: SOROBAN_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    const infoTx = await client.get_info();
    const infoSim = await infoTx.simulate();
    const info = infoSim.result;

    if (!info || info.project_id === undefined || info.project_id === null) {
      return NextResponse.json(
        { success: false, error: "Could not read project_id from vault contract. The vault may not be initialized yet." },
        { status: 422 }
      );
    }

    const numericId = String(info.project_id);

    // Check that this numeric ID is actually valid
    if (!/^\d+$/.test(numericId)) {
      return NextResponse.json(
        { success: false, error: `Vault returned a non-numeric project_id: ${numericId}` },
        { status: 422 }
      );
    }

    // Check for conflicting records that may already use this numeric ID
    const conflicting = await ProjectCache.findOne({
      projectId: numericId,
      vaultAddress: { $ne: vaultAddress },
    }).lean();

    if (conflicting) {
      return NextResponse.json(
        { success: false, error: `Another project already uses numeric ID ${numericId}` },
        { status: 409 }
      );
    }

    // Update the database record with the resolved numeric ID
    await ProjectCache.findOneAndUpdate(
      { vaultAddress },
      { $set: { projectId: numericId } },
      { new: true }
    );

    return NextResponse.json({
      success: true,
      resolved: true,
      previousId: project.projectId,
      projectId: numericId,
      message: `Project ID resolved from temporary to ${numericId}`,
    });
  } catch (error: any) {
    console.error("[resolve-id] Failed to resolve project ID:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
