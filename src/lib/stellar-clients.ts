import { Networks } from "@stellar/stellar-sdk";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as AttestationClient } from "@/packages/blkfndr_attestation/src";
import { Client as IdentityClient } from "@/packages/blkfndr_identity/src";
import { Client as AdminClient } from "@/packages/blkfndr_admin/src";
import { Client as TreasuryClient } from "@/packages/blkfndr_treasury/src";

/**
 * One place to construct contract clients.
 *
 * Before this, contract ids and RPC urls were re-read from the environment at
 * a dozen call sites, several with their own fallback string, so a missing
 * variable surfaced as an opaque RPC error rather than as the configuration
 * problem it was.
 */

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

export const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID;
export const ATTESTATION_ID = process.env.NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID;
export const IDENTITY_ID = process.env.NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID;
export const ADMIN_ID = process.env.NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID;

/** Signing callbacks, supplied by the wallet layer. Absent for reads. */
export interface Signer {
  publicKey?: string;
  signTransaction?: (xdr: string) => Promise<any>;
  signAuthEntry?: (xdr: string) => Promise<any>;
}

function base(contractId: string, signer?: Signer) {
  return {
    contractId,
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    ...(signer?.publicKey ? { publicKey: signer.publicKey } : {}),
    ...(signer?.signTransaction ? { signTransaction: signer.signTransaction } : {}),
    ...(signer?.signAuthEntry ? { signAuthEntry: signer.signAuthEntry } : {}),
  };
}

function required(id: string | undefined, name: string): string {
  if (!id) {
    throw new Error(
      `${name} is not set. The app cannot reach the contracts without it — ` +
        `see the deployed addresses in the README.`,
    );
  }
  return id;
}

/** A specific project's vault. Its address comes from the factory or the cache. */
export function vaultClient(vaultAddress: string, signer?: Signer) {
  return new VaultClient(base(vaultAddress, signer));
}

export function factoryClient(signer?: Signer) {
  return new FactoryClient(
    base(required(FACTORY_ID, "NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID"), signer),
  );
}

export function attestationClient(signer?: Signer) {
  return new AttestationClient(
    base(required(ATTESTATION_ID, "NEXT_PUBLIC_BLKFNDR_ATTESTATION_CONTRACT_ID"), signer),
  );
}

export function identityClient(signer?: Signer) {
  return new IdentityClient(
    base(required(IDENTITY_ID, "NEXT_PUBLIC_BLKFNDR_IDENTITY_CONTRACT_ID"), signer),
  );
}

export function adminClient(signer?: Signer) {
  return new AdminClient(
    base(required(ADMIN_ID, "NEXT_PUBLIC_BLKFNDR_ADMIN_CONTRACT_ID"), signer),
  );
}

/**
 * The platform vault, at whatever address the factory currently sends fees to.
 *
 * Taken from the factory rather than from its own env var, deliberately. There
 * is exactly one correct answer to "where do the fees go", the factory holds it,
 * and a second copy in configuration is a second thing to get wrong — the kind
 * that shows a healthy balance for a vault the fees stopped arriving at.
 */
export function treasuryClient(contractId: string, signer?: Signer) {
  return new TreasuryClient(base(contractId, signer));
}

/** Read a contract without signing. Returns null rather than throwing. */
export async function simulate<T>(
  build: () => Promise<{ simulate: () => Promise<{ result: T }> }>,
  label: string,
): Promise<T | null> {
  try {
    const tx = await build();
    const sim = await tx.simulate();
    return sim.result;
  } catch (error) {
    console.warn(`[stellar] ${label} failed:`, error);
    return null;
  }
}
