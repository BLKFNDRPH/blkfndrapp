// Server-side read of the platform's on-chain settings, for browsers.

import { adminClient, factoryClient, simulate } from "@/lib/stellar-clients";
import { cachedRead } from "@/lib/read-cache";

/** What the app shell needs to know about the platform, as plain JSON. */
export interface PlatformSnapshot {
  /** Every address on the admin roster. */
  admins: string[];
  /** The roster owner; null when get_owner could not be read. */
  owner: string | null;
  /** The factory's flat listing fee, in stroops of the vault's token. */
  feeStroops: number;
  /** The builder's deposit as basis points of the goal (500 = 5%). */
  bondBps: number;
  /** Where the factory sends listing fees; empty when it could not be read. */
  feeWallet: string;
}

/** Settings change only by an admin action, so a minute is plenty. */
export const PLATFORM_TTL_MS = 60_000;

/** The five reads, together. Null when the node answered none of them. */
export async function readPlatform(): Promise<PlatformSnapshot | null> {
  const factory = factoryClient();
  const admin = adminClient();
  const [admins, owner, fee, bondBps, feeWallet] = await Promise.all([
    simulate(() => admin.get_admins(), "get_admins"),
    simulate(() => admin.get_owner(), "get_owner"),
    simulate(() => factory.get_platform_fee(), "get_platform_fee"),
    simulate(() => factory.get_bond_percentage(), "get_bond_percentage"),
    simulate(() => factory.get_fee_wallet(), "get_fee_wallet"),
  ]);
  if (admins === null && fee === null && bondBps === null) return null;
  return {
    admins: (admins as string[] | null) ?? [],
    owner: (owner as string | null) ?? null,
    feeStroops: Number(fee ?? 0),
    bondBps: Number(bondBps ?? 500),
    feeWallet: (feeWallet as string | null) ?? "",
  };
}

/** readPlatform through the read cache; `fresh` reads again. */
export function readPlatformCached(options: { fresh?: boolean } = {}) {
  return cachedRead("platform", PLATFORM_TTL_MS, readPlatform, options);
}
