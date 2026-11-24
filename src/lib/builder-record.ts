/**
 * A builder's record, in one shape.
 *
 * Two things know what a builder has done. The attestation registry holds one
 * permanent entry per vault that has closed, written by the vault itself. The
 * listings table holds the vaults that are still open, which the registry has
 * not heard of yet. The risk pipeline and the public builder profile both need
 * the two together, and both must read the same thing, so it is put together
 * once, here.
 *
 * The output is plain JSON with no floats and no read time in it: the same
 * builder, with the same history, gives the same bytes through canonicalJson,
 * which is what lets a risk report name the record it was built from by hash.
 *
 * Money is never added up across vaults. Each vault is denominated in its own
 * token, so a total would add USDC to XLM.
 *
 * Pure functions, self-contained so node --test can load it. The reads are in
 * src/lib/data/builder-record.ts.
 */

export const BUILDER_RECORD_SCHEMA = "blkfndr.builder-record/1";

export type BuilderOutcome = "completed" | "failed-with-forfeiture" | "failed-to-fund";

/** The registry's Outcome enum, by its on-chain number. */
const OUTCOMES: Record<number, BuilderOutcome> = {
  0: "completed",
  1: "failed-with-forfeiture",
  2: "failed-to-fund",
};

/** An attestation as the contract binding returns it. */
export interface AttestationInput {
  builder: string;
  vault: string;
  project_id: bigint | number | string;
  outcome: number;
  total_raised: bigint | number | string;
  bond_posted: bigint | number | string;
  milestones_total: number;
  milestones_approved: number;
  closed_at: bigint | number | string;
}

/** The part of a listing the record uses. A `Project` satisfies it. */
export interface ListingInput {
  /** The factory's project id. */
  id: string;
  title: string;
  status: string;
  vaultAddress?: string;
  creatorAddress?: string;
  currencyType?: string;
  fundingGoalRaw?: string;
  currentFundingRaw?: string;
  createdAt?: string | null;
}

/** What the listings table adds to a vault the registry names. */
export interface ListingRef {
  title: string;
  currency: string | null;
}

export interface ClosedVault {
  vault: string;
  projectId: string;
  outcome: BuilderOutcome;
  /** Base units of the vault's token. */
  totalRaisedRaw: string;
  bondPostedRaw: string;
  milestonesTotal: number;
  milestonesApproved: number;
  /** Epoch seconds, from the ledger. */
  closedAt: number;
  /** Null when the caller cannot see the listing, or it was never indexed. */
  listing: ListingRef | null;
}

export interface OpenVault {
  vault: string;
  projectId: string;
  title: string;
  currency: string | null;
  /** The listing's status as indexed; not a live read of the vault. */
  status: string;
  goalRaw: string;
  raisedRaw: string;
  /** ISO time the vault was created on chain, when the indexer has it. */
  openedAt: string | null;
}

export interface BuilderRecord {
  schema: typeof BUILDER_RECORD_SCHEMA;
  builder: string;
  summary: {
    completed: number;
    failedWithForfeiture: number;
    failedToFund: number;
    /** Vaults with a registry entry: the three above, added. */
    closed: number;
    open: number;
    /** Across closed vaults only. */
    milestonesApproved: number;
    milestonesTotal: number;
  };
  /** Oldest first. */
  closed: ClosedVault[];
  /** Oldest first. */
  open: OpenVault[];
}

/**
 * Put a builder's attestations and listings together.
 *
 * `attestations` is everything the registry returned for this builder;
 * `listings` is whatever listings the caller may see, for any builder. An
 * attestation or listing naming another builder is left out rather than
 * trusted, and a vault attested twice (the registry forbids it) counts once.
 */
export function buildBuilderRecord(
  builder: string,
  attestations: readonly AttestationInput[],
  listings: readonly ListingInput[],
): BuilderRecord {
  const byVault = new Map<string, ListingInput>();
  for (const listing of listings) {
    if (listing.vaultAddress && listing.creatorAddress === builder) {
      byVault.set(listing.vaultAddress, listing);
    }
  }

  const closedByVault = new Map<string, ClosedVault>();
  for (const a of attestations) {
    if (a.builder !== builder || closedByVault.has(a.vault)) continue;
    const outcome = OUTCOMES[Number(a.outcome)];
    if (!outcome) throw new Error(`Unknown attestation outcome ${a.outcome} for vault ${a.vault}`);
    const listing = byVault.get(a.vault);
    closedByVault.set(a.vault, {
      vault: a.vault,
      projectId: String(a.project_id),
      outcome,
      totalRaisedRaw: String(a.total_raised),
      bondPostedRaw: String(a.bond_posted),
      milestonesTotal: Number(a.milestones_total),
      milestonesApproved: Number(a.milestones_approved),
      closedAt: Number(a.closed_at),
      listing: listing ? { title: listing.title, currency: listing.currencyType ?? null } : null,
    });
  }
  const closed = [...closedByVault.values()].sort(
    (a, b) => a.closedAt - b.closedAt || compare(a.vault, b.vault),
  );

  const open: OpenVault[] = [...byVault.values()]
    .filter((listing) => !closedByVault.has(listing.vaultAddress!))
    .map((listing) => ({
      vault: listing.vaultAddress!,
      projectId: listing.id,
      title: listing.title,
      currency: listing.currencyType ?? null,
      status: listing.status,
      goalRaw: listing.fundingGoalRaw ?? "0",
      raisedRaw: listing.currentFundingRaw ?? "0",
      openedAt: listing.createdAt ?? null,
    }))
    .sort((a, b) => compare(a.openedAt ?? "", b.openedAt ?? "") || compare(a.vault, b.vault));

  const count = (outcome: BuilderOutcome) => closed.filter((v) => v.outcome === outcome).length;
  return {
    schema: BUILDER_RECORD_SCHEMA,
    builder,
    summary: {
      completed: count("completed"),
      failedWithForfeiture: count("failed-with-forfeiture"),
      failedToFund: count("failed-to-fund"),
      closed: closed.length,
      open: open.length,
      milestonesApproved: closed.reduce((n, v) => n + v.milestonesApproved, 0),
      milestonesTotal: closed.reduce((n, v) => n + v.milestonesTotal, 0),
    },
    closed,
    open,
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
