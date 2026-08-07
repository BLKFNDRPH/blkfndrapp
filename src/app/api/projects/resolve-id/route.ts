import { NextRequest, NextResponse } from "next/server";
import { resolveProjectIdByVault } from "@/lib/data/projects";

export async function POST(req: NextRequest) {
  try {
    const { vaultAddress } = await req.json();
    if (!vaultAddress) {
      return NextResponse.json({ error: "vaultAddress is required" }, { status: 400 });
    }
    return NextResponse.json({ projectId: await resolveProjectIdByVault(vaultAddress) });
  } catch (error) {
    console.error("resolve-id:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
