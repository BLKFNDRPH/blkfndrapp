import "server-only";

import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import { FACTORY_ID, SOROBAN_RPC_URL } from "@/lib/stellar-clients";

/**
 * The vault code the factory deploys new projects from.
 *
 * The factory stores the hash under `DataKey::VaultWasmHash` and has no getter
 * for it, so it is read straight out of the factory's instance storage. Shared
 * by the keep-alive job, which keeps that code from expiring, and by the
 * homepage, which shows it so anyone can check it against a build of the source.
 */

export function instanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

export function vaultWasmHashFromFactory(instance: xdr.ScContractInstance): Buffer | null {
  for (const entry of instance.storage() ?? []) {
    const k = entry.key();
    if (
      k.switch().name === "scvVec" &&
      k.vec()?.length === 1 &&
      k.vec()![0].switch().name === "scvSymbol" &&
      k.vec()![0].sym().toString() === "VaultWasmHash" &&
      entry.val().switch().name === "scvBytes"
    ) {
      return entry.val().bytes();
    }
  }
  return null;
}

/** The factory's current vault wasm hash as hex, or null if it cannot be read. */
export async function readFactoryVaultWasmHash(): Promise<string | null> {
  if (!FACTORY_ID) return null;
  const server = new rpc.Server(SOROBAN_RPC_URL);
  const { entries } = await server.getLedgerEntries(instanceKey(FACTORY_ID));
  if (entries.length === 0) return null;
  const instance = entries[0].val.contractData().val().instance();
  return vaultWasmHashFromFactory(instance)?.toString("hex") ?? null;
}
