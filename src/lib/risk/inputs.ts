/**
 * The fixed shapes of a risk report's three inputs.
 *
 * A report names each input by canonicalHash, so each input needs one exact
 * form: the same listing text, or the same vault terms, must give the same
 * bytes on any machine. These functions take what the app already reads (an
 * indexed listing, a live `get_info` from the vault) and keep only the fields
 * the scoring reads, as strings and safe integers.
 *
 * The builder-record input is the output of src/lib/builder-record.ts as is.
 *
 * Self-contained so node --test can load it.
 */

export const LISTING_INPUT_SCHEMA = "blkfndr.risk-listing/1";
export const VAULT_TERMS_SCHEMA = "blkfndr.vault-terms/1";

/** The part of a listing a risk report is written from. A `Project` satisfies it. */
export interface ListingSource {
  id: string;
  title: string;
  tagline?: string | null;
  description?: string | null;
  category?: string | null;
  location?: string | null;
  imageUrl?: string | null;
  metadataCid?: string | null;
}

export interface ListingInputV1 {
  schema: typeof LISTING_INPUT_SCHEMA;
  projectId: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  location: string;
  hasImage: boolean;
  metadataCid: string;
}

export function listingInput(listing: ListingSource): ListingInputV1 {
  return {
    schema: LISTING_INPUT_SCHEMA,
    projectId: String(listing.id),
    title: (listing.title ?? "").trim(),
    tagline: (listing.tagline ?? "").trim(),
    description: (listing.description ?? "").trim(),
    category: (listing.category ?? "").trim(),
    location: (listing.location ?? "").trim(),
    hasImage: Boolean(listing.imageUrl),
    metadataCid: listing.metadataCid ?? "",
  };
}

/** `get_info` as the vault binding returns it; only the fields used here. */
export interface VaultInfoSource {
  project_id: bigint | number | string;
  creator: string;
  token: string;
  goal: bigint | number | string;
  deadline: bigint | number | string;
  bond_amount: bigint | number | string;
  bond_posted: boolean;
  min_contribution: bigint | number | string;
  voting_window_secs: bigint | number | string;
  platform_fee: bigint | number | string;
  milestones: readonly { id: number; amount: bigint | number | string }[];
}

export interface VaultTermsV1 {
  schema: typeof VAULT_TERMS_SCHEMA;
  vault: string;
  projectId: string;
  creator: string;
  token: string;
  /** Base units of the vault's token, as decimal strings. */
  goalRaw: string;
  bondRaw: string;
  bondPosted: boolean;
  minContributionRaw: string;
  platformFeeRaw: string;
  /** Epoch seconds. */
  deadline: number;
  votingWindowSecs: number;
  /** In milestone order. */
  milestones: { id: number; amountRaw: string }[];
}

/**
 * The vault's terms as fixed at creation. Running totals (raised, released,
 * votes) are left out on purpose: they move with every stake, and a report
 * re-run because someone staked would be a new report about nothing new.
 */
export function vaultTermsInput(vault: string, info: VaultInfoSource): VaultTermsV1 {
  return {
    schema: VAULT_TERMS_SCHEMA,
    vault,
    projectId: String(info.project_id),
    creator: info.creator,
    token: info.token,
    goalRaw: String(info.goal),
    bondRaw: String(info.bond_amount),
    bondPosted: Boolean(info.bond_posted),
    minContributionRaw: String(info.min_contribution),
    platformFeeRaw: String(info.platform_fee),
    deadline: Number(info.deadline),
    votingWindowSecs: Number(info.voting_window_secs),
    milestones: [...info.milestones]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((m) => ({ id: Number(m.id), amountRaw: String(m.amount) })),
  };
}
