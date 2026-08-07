import dns from "node:dns";
import https from "node:https";

// grpc and some RPC providers misbehave on dual-stack hosts. Set before the
// Stellar SDK opens a connection.
if (typeof window === "undefined") {
  dns.setDefaultResultOrder("ipv4first");
  https.globalAgent.options.family = 4;
}

import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { getIPFSFetchUrl } from "./pinata-client";
import { SOROBAN_RPC_URL, FACTORY_ID } from "./stellar-clients";
import { readVaultState } from "./vault-state";
import { currencyForToken } from "./currencies";
import { getCursor, setCursor, recordEvent, markProcessed } from "./data/events";
import {
  upsertProjectFromChain,
  upsertMilestones,
  getProjectByVault,
} from "./data/projects";
import { createAdminClient } from "./supabase/admin";
import type { Enums } from "./supabase/database.types";

/**
 * Reads contract events and mirrors them into Postgres.
 *
 * Two correctness problems the Mongo version had are gone by construction:
 *
 *   * an event was written with `processed: true` before its handler ran, so a
 *     handler that threw left it permanently marked done and never retried.
 *     `processed_at` is now set only on success, and a failure is recorded.
 *   * the ledger cursor advanced to the highest ledger seen even when handlers
 *     threw, so failures silently skipped work. The cursor now advances only
 *     past events that were actually handled.
 */

const rpcServer = new rpc.Server(SOROBAN_RPC_URL);

/** How far back to start when there is no cursor. */
const COLD_START_LEDGERS = 10_000;
/** RPC will not serve events older than roughly this. */
const MAX_LOOKBACK_LEDGERS = 30_000;
const PAGE_SIZE = 200;

const VAULT_STATUS: Record<number, Enums<"project_status">> = {
  0: "raising",
  1: "funded",
  2: "active",
  3: "failed",
  4: "refunding",
  5: "completed",
};

async function fetchMetadata(cid: string): Promise<any> {
  if (!cid || cid.trim() === "" || cid === "test_cid") return null;

  // Strict CID resolution only. The value arrives from an on-chain event any
  // project creator controls, so an absolute URL here would be an SSRF.
  const url = getIPFSFetchUrl(cid);
  if (!url) {
    console.warn(`[Indexer] Ignoring non-CID metadata reference: ${cid}`);
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    // Anyone can pin anything at a CID; cap what we parse.
    const MAX_BYTES = 256 * 1024;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const body = await response.text();
    if (body.length > MAX_BYTES) return null;

    return JSON.parse(body);
  } catch (err) {
    console.warn(`[Indexer] Could not fetch metadata for ${cid}:`, err);
    return null;
  }
}

/** Every vault address we have seen, so their events are watched too. */
async function watchedContracts(): Promise<string[]> {
  if (!FACTORY_ID) return [];

  const admin = createAdminClient();
  const { data } = await admin.from("projects").select("vault_address");
  const vaults = (data ?? []).map((r) => r.vault_address).filter(Boolean);

  return Array.from(new Set([FACTORY_ID, ...vaults]));
}

/** Refresh a project's figures from the ledger rather than from event payloads. */
async function syncVault(vaultAddress: string, ledger?: number) {
  const state = await readVaultState(vaultAddress);
  // Throw rather than return quietly. This event exists because a vault we
  // already know about changed, so being unable to read it is a failure, not an
  // absence — and treating it as an absence is what let the Contract-object bug
  // above drop every state change without a single failed count.
  if (!state) {
    throw new Error(
      `Vault ${vaultAddress} changed but could not be read; leaving the event unprocessed for retry`,
    );
  }

  const existing = await getProjectByVault(vaultAddress);

  const projectRowId = await upsertProjectFromChain({
    projectId: existing?.id ?? vaultAddress,
    vaultAddress,
    creatorAddress: state.creator,
    fundingGoalRaw: state.fundingGoalRaw,
    currentFundingRaw: state.currentFundingRaw,
    bondAmountRaw: String(BigInt(Math.round(state.bondAmount * 10_000_000))),
    releasedTotalRaw: String(BigInt(Math.round(state.releasedTotal * 10_000_000))),
    status: (VAULT_STATUS[-1] ?? state.status) as Enums<"project_status">,
    bondPosted: state.bondPosted,
    fundingDeadline: new Date(state.fundingDeadline),
    createdOnChainAt: existing?.createdAt ? new Date(existing.createdAt) : new Date(),
    ...(ledger !== undefined ? { lastUpdatedLedger: ledger } : {}),
  });

  await upsertMilestones(
    projectRowId,
    state.milestones.map((m) => ({
      milestoneId: m.id,
      amountRaw: String(BigInt(Math.round(m.amount * 10_000_000))),
      released: m.released,
    })),
  );
}

async function handleEvent(topic1: string, topic2: string, payload: any[], contractId: string, ledger: number, closedAt?: string) {
  const key = `${topic1}/${topic2}`;

  switch (key) {
    case "FACTORY/DEPLOY": {
      // [project_id, vault_address, creator, metadata_cid]
      const [projectId, vaultAddress, creator, metadataCid] = payload;
      const metadata = (await fetchMetadata(String(metadataCid ?? ""))) ?? {};

      const state = await readVaultState(String(vaultAddress));
      if (!state) throw new Error(`Vault ${vaultAddress} is not readable`);

      // Denomination comes from the vault's token address, never from
      // `metadata.currency`. The column defaults to USDC and this handler used
      // to write nothing, so every vault was recorded as USDC no matter what it
      // held — the listing then misstated the asset a backer is asked to send.
      // An unconfigured token is left at the default and logged, not guessed.
      const currency = currencyForToken(state.token);
      if (!currency) {
        console.warn(
          `[Indexer] Vault ${vaultAddress} holds unconfigured token ${state.token}; ` +
            `currency left at the column default. Set the matching ` +
            `NEXT_PUBLIC_STELLAR_*_TOKEN_ID.`,
        );
      }

      const projectRowId = await upsertProjectFromChain({
        projectId: String(projectId),
        vaultAddress: String(vaultAddress),
        creatorAddress: String(creator),
        title: metadata.title ?? `Project #${projectId}`,
        tagline: metadata.tagline ?? "",
        description: metadata.description ?? "",
        category: metadata.category ?? "General",
        imageUrl: metadata.imageUrl ?? "",
        metadataCid: String(metadataCid ?? ""),
        ...(currency ? { currency } : {}),
        fundingGoalRaw: state.fundingGoalRaw,
        currentFundingRaw: state.currentFundingRaw,
        bondAmountRaw: String(BigInt(Math.round(state.bondAmount * 10_000_000))),
        status: state.status as Enums<"project_status">,
        bondPosted: state.bondPosted,
        fundingDeadline: new Date(state.fundingDeadline),
        createdOnChainAt: closedAt ? new Date(closedAt) : new Date(),
        lastUpdatedLedger: ledger,
      });

      await upsertMilestones(
        projectRowId,
        state.milestones.map((m) => {
          const meta = (metadata.milestones ?? []).find(
            (x: any) => Number(x.id) === m.id,
          );
          return {
            milestoneId: m.id,
            amountRaw: String(BigInt(Math.round(m.amount * 10_000_000))),
            released: m.released,
            ...(meta?.title ? { title: String(meta.title) } : {}),
            ...(meta?.description ? { description: String(meta.description) } : {}),
          };
        }),
      );
      return;
    }

    // Everything else is a state change on a vault we already know. Rather than
    // trusting the payload's numbers, re-read the vault — the event tells us
    // *when* to look, not *what* is true.
    case "VAULT/INIT":
    case "VAULT/FUNDED":
    case "VAULT/FAILED":
    case "BOND/POSTED":
    case "BOND/RETURNED":
    case "BOND/SLASHED":
    case "DEPOSIT/CONTRIB":
    case "DEPOSIT/REFUND":
    case "MILESTN/VOTEOPEN":
    case "MILESTN/APPROVE":
    case "MILESTN/RELEASE":
    case "MILESTN/FAILED":
      await syncVault(contractId, ledger);
      return;

    case "ATTEST/RECORDED":
      // The permanent record lives on chain and is read directly when needed.
      return;

    default:
      return;
  }
}

export async function runIndexer() {
  if (!FACTORY_ID) {
    return { success: false, error: "NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID is not set" };
  }

  let latestLedger = 0;
  try {
    latestLedger = (await rpcServer.getLatestLedger()).sequence;
  } catch (err) {
    return { success: false, error: `Could not reach RPC: ${String(err)}` };
  }

  const stored = await getCursor();
  let startLedger = stored !== null ? stored + 1 : latestLedger - COLD_START_LEDGERS;

  // RPC will not serve events older than its retention window.
  if (startLedger < latestLedger - MAX_LOOKBACK_LEDGERS || startLedger > latestLedger) {
    startLedger = Math.max(1, latestLedger - COLD_START_LEDGERS);
  }

  const contractIds = await watchedContracts();
  const events: any[] = [];

  // Paginated. The previous version took the first 100 and advanced the cursor
  // past everything, so anything beyond that page was lost permanently.
  for (let i = 0; i < contractIds.length; i += 5) {
    const chunk = contractIds.slice(i, i + 5);
    let cursor: string | undefined;

    for (let page = 0; page < 20; page++) {
      try {
        const response: any = await rpcServer.getEvents({
          ...(cursor ? { cursor } : { startLedger }),
          filters: [{ type: "contract", contractIds: chunk }],
          limit: PAGE_SIZE,
        } as any);

        const batch = response?.events ?? [];
        events.push(...batch);

        if (batch.length < PAGE_SIZE) break;
        cursor = response?.cursor ?? batch[batch.length - 1]?.pagingToken;
        if (!cursor) break;
      } catch (err) {
        console.error(`[Indexer] getEvents failed for ${chunk.join(", ")}:`, err);
        break;
      }
    }
  }

  events.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  let processed = 0;
  let failed = 0;
  // Only advances past events that were actually handled.
  let safeLedger = startLedger - 1;

  for (const raw of events) {
    const topics = (raw.topic ?? []).map((t: any) => String(scValToNative(t)));
    const payload = scValToNative(raw.value);

    // `contractId` arrives as a Contract instance, not a string. Passing it on
    // is silently destructive in both directions: it stores as a serialised
    // Buffer rather than an address, and `new Contract(<Contract>)` throws
    // "Invalid contract ID" — with the object's own toString in the message, so
    // the error names a perfectly valid address and reads like an RPC fault.
    // readVaultState catches that and returns null, and syncVault treats null as
    // nothing-to-do, so every vault state change was dropped without a trace and
    // a project's figures never moved past whatever DEPLOY first saw.
    const contractId = String(raw.contractId);

    const isNew = await recordEvent({
      eventId: raw.id,
      ledger: raw.ledger,
      ledgerClosedAt: raw.ledgerClosedAt ?? null,
      contractId,
      topic1: topics[0] ?? "",
      topic2: topics[1] ?? "",
      payload: payload as never,
    });

    if (!isNew) {
      safeLedger = Math.max(safeLedger, raw.ledger);
      continue;
    }

    try {
      await handleEvent(
        topics[0] ?? "",
        topics[1] ?? "",
        Array.isArray(payload) ? payload : [payload],
        contractId,
        raw.ledger,
        raw.ledgerClosedAt,
      );
      await markProcessed(raw.id);
      processed++;
      safeLedger = Math.max(safeLedger, raw.ledger);
    } catch (err) {
      // Recorded, visible, and retryable — the cursor does not move past it.
      await markProcessed(raw.id, String(err));
      failed++;
      console.error(`[Indexer] Failed to handle ${raw.id}:`, err);
      break;
    }
  }

  if (safeLedger >= startLedger) {
    await setCursor(safeLedger);
  }

  return { success: failed === 0, count: processed, failed, currentLedger: safeLedger };
}
