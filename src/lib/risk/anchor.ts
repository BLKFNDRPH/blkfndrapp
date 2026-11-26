import "server-only";

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, SOROBAN_RPC_URL } from "@/lib/stellar-clients";
import { RISK_REPORT_SCHEMA_VERSION } from "@/lib/risk/report";

/**
 * Write a report's hash to the report-anchor registry
 * (contracts/blkfndr-report-anchor), signed by the attestor key.
 *
 * D1 (2026-11-25): a dedicated attestor key, not the ops key. It is read from
 * RISK_ATTESTOR_SECRET and must be on the registry's roster. The registry's
 * address is NEXT_PUBLIC_BLKFNDR_REPORT_ANCHOR_CONTRACT_ID.
 *
 * Called without a generated binding: the call is one method with four plain
 * arguments, and the contract's own checks (roster, hash already anchored)
 * are the real gate.
 */

export const REPORT_ANCHOR_ID = process.env.NEXT_PUBLIC_BLKFNDR_REPORT_ANCHOR_CONTRACT_ID;

export interface AnchorResult {
  contract: string;
  seq: number;
  tx: string;
  /** Epoch seconds, the ledger close time the registry recorded. */
  anchoredAt: number;
}

/** Why anchoring is off, or null when it is configured. */
export function anchorUnavailable(): string | null {
  if (!REPORT_ANCHOR_ID) return "NEXT_PUBLIC_BLKFNDR_REPORT_ANCHOR_CONTRACT_ID is not set";
  if (!process.env.RISK_ATTESTOR_SECRET) return "RISK_ATTESTOR_SECRET is not set";
  return null;
}

export async function anchorReport(vault: string, reportHash: string): Promise<AnchorResult> {
  const why = anchorUnavailable();
  if (why) throw new Error(why);
  if (!/^[0-9a-f]{64}$/.test(reportHash)) throw new Error(`Not a report hash: ${reportHash}`);

  const contractId = REPORT_ANCHOR_ID!;
  const kp = Keypair.fromSecret(process.env.RISK_ATTESTOR_SECRET!);
  const server = new rpc.Server(SOROBAN_RPC_URL);
  // Already anchored, by an earlier run whose database write was lost: the
  // registry refuses the hash a second time, so recover the anchor instead.
  const existing = await read<{ seq: number; vault: string; anchored_at: bigint } | undefined>(
    server,
    contractId,
    kp.publicKey(),
    "find",
    [xdr.ScVal.scvBytes(Buffer.from(reportHash, "hex"))],
  );
  if (existing) {
    if (existing.vault !== vault) {
      throw new Error(`Hash ${reportHash} is already anchored for another vault, ${existing.vault}`);
    }
    return {
      contract: contractId,
      seq: Number(existing.seq),
      tx: "recovered",
      anchoredAt: Number(existing.anchored_at),
    };
  }

  const account = await server.getAccount(kp.publicKey());

  const op = new Contract(contractId).call(
    "anchor",
    new Address(kp.publicKey()).toScVal(),
    new Address(vault).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(reportHash, "hex")),
    nativeToScVal(RISK_REPORT_SCHEMA_VERSION, { type: "u32" }),
  );
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  // Simulation runs the contract's checks; a hash already anchored or a key
  // off the roster fails here, before anything is sent.
  const prepared = await server.prepareTransaction(built);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
    throw new Error(`Anchor transaction was refused: ${sent.status} ${JSON.stringify(sent.errorResult ?? "")}`);
  }

  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Anchor transaction ${sent.hash} ended ${final.status}`);
  }
  const seq = Number(scValToNative(final.returnValue!));

  // Read the anchor back for the time the registry recorded.
  const anchor = await read<{ anchored_at: bigint }>(server, contractId, kp.publicKey(), "get_anchor", [
    new Address(vault).toScVal(),
    nativeToScVal(seq, { type: "u32" }),
  ]);
  return { contract: contractId, seq, tx: sent.hash, anchoredAt: Number(anchor.anchored_at) };
}

/** Simulate a read-only call and decode its result. */
async function read<T>(
  server: rpc.Server,
  contractId: string,
  source: string,
  method: string,
  args: xdr.ScVal[],
): Promise<T> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`Report-anchor ${method} failed: ${"error" in sim ? sim.error : "no result"}`);
  }
  return scValToNative(sim.result.retval) as T;
}
