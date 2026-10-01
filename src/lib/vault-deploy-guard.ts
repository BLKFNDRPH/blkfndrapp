import { rpc, scValToNative } from "@stellar/stellar-sdk";
import {
  factoryClient,
  vaultClient,
  simulate,
  SOROBAN_RPC_URL,
} from "@/lib/stellar-clients";

/**
 * Has this draft already become a vault?
 *
 * A launch can fail after its transaction reached the network -- the
 * confirmation timed out, the tab lost its connection -- and the builder's
 * natural response is to press Launch Campaign again. That would deploy a
 * second vault and pull a second bond. So before anything is signed, the
 * newest vaults are read back from the chain and compared with this draft:
 * same creator, same metadata CID.
 *
 * The CID is what makes the comparison meaningful. Pinata pins by content, so
 * an unchanged draft produces the same metadata CID on every attempt, even
 * after a reload; a draft that was edited is a different project and gets a
 * different one.
 *
 * Contract reads rather than events: the factory numbers its vaults and every
 * vault records its creator and metadata CID, so the answer does not depend on
 * how long an RPC node keeps event history. Each read is a free simulation.
 */

export interface DeployedVault {
  projectId: number;
  vaultAddress: string;
}

/** How far back to look. A retry follows its failure within minutes. */
const LOOKBACK = 5;

/**
 * The vault this creator already deployed for this metadata, or null.
 *
 * Throws when the factory cannot be read at all, rather than reporting "no
 * vault": a guard that silently answers "none found" whenever the network is
 * unreachable is a guard that lets the duplicate through.
 */
export async function findDeployedVault(
  creator: string,
  metadataCid: string,
): Promise<DeployedVault | null> {
  if (!creator || !metadataCid) return null;

  const count = await simulate(
    () => factoryClient().get_project_count(),
    "get_project_count",
  );
  if (count === null) {
    throw new Error("Could not read the factory to check for an existing vault.");
  }

  const newest = Number(count);
  const ids: number[] = [];
  for (let id = newest; id > Math.max(0, newest - LOOKBACK); id--) ids.push(id);

  const candidates = await Promise.all(
    ids.map(async (id) => {
      const vaultAddress = await simulate(
        () => factoryClient().get_vault({ project_id: BigInt(id) }),
        `get_vault(${id})`,
      );
      if (!vaultAddress) return null;
      // An older vault without this ProjectInfo shape fails to decode and
      // simply does not match -- it cannot be the draft being launched now.
      const info = await simulate(
        () => vaultClient(String(vaultAddress)).get_info(),
        `get_info(${vaultAddress})`,
      );
      if (!info) return null;
      return {
        projectId: id,
        vaultAddress: String(vaultAddress),
        creator: String(info.creator),
        metadataCid: String(info.metadata_cid),
      };
    }),
  );

  const match = candidates.find(
    (c) => c !== null && c.creator === creator && c.metadataCid === metadataCid,
  );
  return match ? { projectId: match.projectId, vaultAddress: match.vaultAddress } : null;
}

export type SubmittedOutcome =
  | { status: "SUCCESS"; vaultAddress: string | null }
  | { status: "FAILED" }
  | { status: "EXPIRED" }
  | { status: "UNKNOWN" };

/** Ledgers close every ~5 s; give the last possible one time to be reported. */
const EXPIRY_GRACE_MS = 15_000;
const POLL_MS = 5_000;

/**
 * What became of a launch that was sent but whose confirmation went wrong.
 *
 * A signed transaction carries a deadline (the SDK stamps one as it signs), so
 * the question has a definite answer: watch until the network reports it
 * applied or failed, or until its deadline has passed -- after which it can
 * never be applied, and a fresh launch is safe. Only an RPC node that cannot
 * be reached at all leaves the answer UNKNOWN.
 *
 * `expiresAtMs` is the transaction's maxTime. Without one, a short fixed
 * window is used instead.
 */
export async function resolveSubmittedLaunch(
  hash: string,
  expiresAtMs: number | null,
): Promise<SubmittedOutcome> {
  const server = new rpc.Server(SOROBAN_RPC_URL);
  const giveUpAt = (expiresAtMs ?? Date.now() + 30_000) + EXPIRY_GRACE_MS;
  let answered = false;

  for (;;) {
    try {
      const res = await server.getTransaction(hash);
      answered = true;
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        let vaultAddress: string | null = null;
        try {
          vaultAddress = res.returnValue ? String(scValToNative(res.returnValue)) : null;
        } catch {
          // Applied all the same; the caller can still say so.
        }
        return { status: "SUCCESS", vaultAddress };
      }
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        return { status: "FAILED" };
      }
    } catch (error) {
      console.warn("[launch] could not read transaction", hash, error);
    }

    if (Date.now() >= giveUpAt) {
      // Past its deadline and still not found: it was never applied.
      return answered ? { status: "EXPIRED" } : { status: "UNKNOWN" };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
