import dns from "node:dns";
import https from "node:https";

// grpc and some RPC providers misbehave on dual-stack hosts. Set before the
// Stellar SDK opens a connection.
if (typeof window === "undefined") {
  dns.setDefaultResultOrder("ipv4first");
  https.globalAgent.options.family = 4;
}

import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { getIPFSFetchUrls } from "./pinata-client";
import { SOROBAN_RPC_URL, FACTORY_ID } from "./stellar-clients";
import { readVaultState } from "./vault-state";
import { currencyForToken } from "./currencies";
import { getCursor, setCursor, recordEvent, markProcessed } from "./data/events";
import { upsertProjectFromChain, upsertMilestones } from "./data/projects";
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
const PAGE_SIZE = 200;
/** Enough empty scan windows to cross the RPC's whole retention (~120k ledgers). */
const MAX_PAGES = 60;

/**
 * The last ledger a getEvents cursor has fully scanned.
 *
 * A cursor is a TOID: the ledger sits in the high 32 bits. The RPC scans a
 * bounded window per request (10,000 ledgers on testnet) and, when that window
 * is empty, returns no events and a cursor at its end. Knowing where the cursor
 * stands is the only way to tell "nothing more" from "nothing in this window".
 */
function cursorLedger(cursor: string): number {
  const [toid] = cursor.split("-");
  const id = BigInt(toid);
  const ledger = Number(id >> 32n);
  // Low bits all set mean the whole ledger was scanned; otherwise it stopped
  // partway through and only the ledger before is complete.
  return (id & 0xffffffffn) === 0xffffffffn ? ledger : ledger - 1;
}

const VAULT_STATUS: Record<number, Enums<"project_status">> = {
  0: "raising",
  1: "funded",
  2: "active",
  3: "failed",
  4: "refunding",
  5: "completed",
};

export async function fetchMetadata(cid: string): Promise<any> {
  if (!cid || cid.trim() === "" || cid === "test_cid") return null;

  // Strict CID resolution only. The value arrives from an on-chain event any
  // project creator controls, so an absolute URL here would be an SSRF.
  const urls = getIPFSFetchUrls(cid);
  if (urls.length === 0) {
    console.warn(`[Indexer] Ignoring non-CID metadata reference: ${cid}`);
    return null;
  }

  // Each gateway is tried in turn. A refusal used to end the lookup silently,
  // which is how every project came to be listed as "Project #N".
  for (const url of urls) {
    const host = new URL(url).host;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        console.warn(`[Indexer] ${host} answered ${response.status} for metadata ${cid}`);
        continue;
      }

      // Anyone can pin anything at a CID; cap what we parse.
      const MAX_BYTES = 256 * 1024;
      if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
      const body = await response.text();
      if (body.length > MAX_BYTES) return null;

      return JSON.parse(body);
    } catch (err) {
      console.warn(`[Indexer] Could not fetch metadata ${cid} from ${host}:`, err);
    }
  }
  return null;
}

/** Every vault address we have seen, so their events are watched too. */
async function watchedContracts(): Promise<string[]> {
  if (!FACTORY_ID) return [];

  const admin = createAdminClient();
  const { data } = await admin.from("projects").select("vault_address");
  const vaults = (data ?? []).map((r) => r.vault_address).filter(Boolean);

  return Array.from(new Set([FACTORY_ID, ...vaults]));
}

/**
 * The row as the indexer owns it — read with the service role, never through a
 * session.
 *
 * The scheduled run has no session, so a session read here ran as anon, and RLS
 * hides every project that is not public: hidden, awaiting consensus, or by a
 * banned builder. The row then looked absent, the fallback in syncVault
 * re-keyed it to its vault address and stamped it created now, and every
 * reference to its real project id — the consensus record, a stakeholder's
 * receipts, the link from a notification — quietly stopped matching it.
 */
async function indexedRow(vaultAddress: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("project_id, created_on_chain_at")
    .eq("vault_address", vaultAddress)
    .maybeSingle();

  if (error) throw new Error(`Could not read project ${vaultAddress}: ${error.message}`);
  return data;
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

  const existing = await indexedRow(vaultAddress);

  const projectRowId = await upsertProjectFromChain({
    projectId: existing?.project_id ?? vaultAddress,
    vaultAddress,
    creatorAddress: state.creator,
    fundingGoalRaw: state.fundingGoalRaw,
    currentFundingRaw: state.currentFundingRaw,
    bondAmountRaw: String(BigInt(Math.round(state.bondAmount * 10_000_000))),
    releasedTotalRaw: String(BigInt(Math.round(state.releasedTotal * 10_000_000))),
    status: (VAULT_STATUS[-1] ?? state.status) as Enums<"project_status">,
    bondPosted: state.bondPosted,
    fundingDeadline: new Date(state.fundingDeadline),
    createdOnChainAt: existing?.created_on_chain_at
      ? new Date(existing.created_on_chain_at)
      : new Date(),
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

/** The project copy a resolved metadata document supplies. */
function metadataFields(metadata: any) {
  return {
    title: String(metadata.title ?? "").trim() || undefined,
    tagline: String(metadata.tagline ?? ""),
    description: String(metadata.description ?? ""),
    category: String(metadata.category ?? "") || "General",
    imageUrl: String(metadata.imageUrl ?? ""),
    // Creator-supplied and never verified, so it is bounded here rather than
    // trusted: the column takes whatever IPFS returns, and IPFS returns
    // whatever the creator pinned.
    location: String(metadata.location ?? "").slice(0, 160),
  };
}

function milestoneCopy(metadata: any, milestoneId: number) {
  const meta = (metadata?.milestones ?? []).find((x: any) => Number(x.id) === milestoneId);
  return {
    ...(meta?.title ? { title: String(meta.title) } : {}),
    ...(meta?.description ? { description: String(meta.description) } : {}),
  };
}

/** Projects still listed under the placeholder title, retried per run. */
const METADATA_RETRIES_PER_RUN = 5;

/**
 * Fill in copy for projects whose metadata did not resolve when DEPLOY was
 * handled. The event cursor moves on regardless, so without this a gateway
 * that was down or rate-limiting for one run left a project as "Project #N"
 * for good.
 *
 * A project still carrying `Project #<its id>` as its title is taken to be
 * unresolved. The few that are tried per run keep a CID that never resolves —
 * a test pin, say — from costing more than a handful of fetches each time.
 */
export async function resolvePendingMetadata() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("id, project_id, title, metadata_cid")
    .like("title", "Project #%")
    .neq("metadata_cid", "")
    .order("created_on_chain_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not read unresolved projects: ${error.message}`);

  const pending = (data ?? [])
    .filter((p) => p.title === `Project #${p.project_id}`)
    .slice(0, METADATA_RETRIES_PER_RUN);

  let resolved = 0;
  for (const project of pending) {
    const metadata = await fetchMetadata(project.metadata_cid);
    if (!metadata) continue;

    const fields = metadataFields(metadata);
    const { error: updateError } = await admin
      .from("projects")
      .update({
        ...(fields.title ? { title: fields.title } : {}),
        tagline: fields.tagline,
        description: fields.description,
        category: fields.category,
        image_url: fields.imageUrl,
        location: fields.location,
      })
      .eq("id", project.id);
    if (updateError) {
      console.warn(`[Indexer] Could not store metadata for project ${project.project_id}: ${updateError.message}`);
      continue;
    }

    for (const m of metadata.milestones ?? []) {
      const copy = milestoneCopy(metadata, Number(m.id));
      if (Object.keys(copy).length === 0) continue;
      await admin
        .from("project_milestones")
        .update(copy)
        .eq("project_id", project.id)
        .eq("milestone_id", Number(m.id));
    }
    resolved++;
  }
  return { pending: pending.length, resolved };
}

async function handleEvent(topic1: string, topic2: string, payload: any[], contractId: string, ledger: number, closedAt?: string) {
  const key = `${topic1}/${topic2}`;

  switch (key) {
    case "FACTORY/DEPLOY": {
      // [project_id, vault_address, creator, metadata_cid]
      const [projectId, vaultAddress, creator, metadataCid] = payload;
      const metadata = await fetchMetadata(String(metadataCid ?? ""));

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
        // Unresolved metadata writes nothing, so a replay that cannot reach IPFS
        // does not overwrite copy an earlier run resolved. The row is listed as
        // "Project #N" until resolvePendingMetadata fills it in.
        ...(metadata ? metadataFields(metadata) : {}),
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
        state.milestones.map((m) => ({
          milestoneId: m.id,
          amountRaw: String(BigInt(Math.round(m.amount * 10_000_000))),
          released: m.released,
          ...milestoneCopy(metadata, m.id),
        })),
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
  let oldestLedger = 1;
  try {
    const health = await rpcServer.getHealth();
    latestLedger = health.latestLedger;
    oldestLedger = health.oldestLedger ?? 1;
  } catch (err) {
    return { success: false, error: `Could not reach RPC: ${String(err)}` };
  }

  const stored = await getCursor();
  let startLedger = stored !== null ? stored + 1 : latestLedger - COLD_START_LEDGERS;

  // RPC will not serve events older than its retention window. Start at its
  // edge rather than skipping further ahead than the window forces us to.
  if (startLedger < oldestLedger) startLedger = oldestLedger;
  // Caught up: nothing has closed since the last run.
  if (startLedger > latestLedger) {
    return { success: true, count: 0, failed: 0, currentLedger: stored };
  }

  const contractIds = await watchedContracts();
  const events: any[] = [];
  // The highest ledger every chunk has been scanned through. The cursor may move
  // this far even when nothing happened — without that, a quiet stretch longer
  // than one RPC scan window left every later run rescanning the same empty
  // window, and new projects never reached the database.
  let scannedThrough = latestLedger;

  for (let i = 0; i < contractIds.length; i += 5) {
    const chunk = contractIds.slice(i, i + 5);
    let cursor: string | undefined;
    let chunkThrough = startLedger - 1;

    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const response: any = await rpcServer.getEvents({
          ...(cursor ? { cursor } : { startLedger }),
          filters: [{ type: "contract", contractIds: chunk }],
          limit: PAGE_SIZE,
        } as any);

        const batch = response?.events ?? [];
        events.push(...batch);

        const next = response?.cursor ?? batch[batch.length - 1]?.pagingToken;
        if (!next || next === cursor) break;
        cursor = next;
        chunkThrough = cursorLedger(next);

        // A short page only means this scan window is exhausted, not the chain.
        if (batch.length < PAGE_SIZE && chunkThrough >= (response?.latestLedger ?? latestLedger)) {
          break;
        }
      } catch (err) {
        console.error(`[Indexer] getEvents failed for ${chunk.join(", ")}:`, err);
        break;
      }
    }

    scannedThrough = Math.min(scannedThrough, chunkThrough);
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

  // With every event handled, the cursor moves to where the scan reached, quiet
  // ledgers included. It never moves past a chunk that did not finish scanning.
  const nextCursor = Math.min(
    failed === 0 ? Math.max(safeLedger, scannedThrough) : safeLedger,
    scannedThrough,
  );
  const advanced = nextCursor >= startLedger;
  if (advanced) {
    await setCursor(nextCursor);
  }

  // Best effort: copy is cosmetic, and a gateway outage must not fail the run
  // that keeps balances and statuses current.
  let metadata: { pending: number; resolved: number } | { error: string };
  try {
    metadata = await resolvePendingMetadata();
  } catch (err) {
    metadata = { error: String(err) };
    console.warn("[Indexer] Metadata retry pass failed:", err);
  }

  return {
    success: failed === 0,
    count: processed,
    failed,
    currentLedger: advanced ? nextCursor : stored,
    metadata,
  };
}
