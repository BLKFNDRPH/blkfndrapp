import { NextResponse } from "next/server";
import { FACTORY_ID } from "@/lib/stellar-clients";
import { readFactoryVaultWasmHash } from "@/lib/factory-vault-hash";

export const dynamic = "force-dynamic";

/**
 * The vault code hash the factory is deploying new projects from, read live
 * from the chain for the homepage's "check it yourself" box.
 *
 * Read rather than written into the page, so the box stays true across a vault
 * upgrade without anyone remembering to edit it. Public and unauthenticated —
 * it is a ledger value anyone can read — and cached briefly so the homepage
 * does not put an RPC call behind every visit.
 */

const TTL_MS = 5 * 60 * 1000;
let cached: { hash: string; at: number } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ hash: cached.hash, factory: FACTORY_ID });
  }
  try {
    const hash = await readFactoryVaultWasmHash();
    if (!hash) {
      return NextResponse.json({ error: "The factory has no vault code hash set." }, { status: 502 });
    }
    cached = { hash, at: Date.now() };
    return NextResponse.json({ hash, factory: FACTORY_ID });
  } catch (error) {
    console.error("Error reading the factory's vault wasm hash:", error);
    return NextResponse.json({ error: "Could not read the factory." }, { status: 502 });
  }
}
