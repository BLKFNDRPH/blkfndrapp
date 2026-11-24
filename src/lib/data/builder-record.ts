import "server-only";

import { attestationClient, simulate } from "@/lib/stellar-clients";
import { isStellarAccount } from "@/lib/stellar-address";
import { getProjects } from "@/lib/data/projects";
import {
  buildBuilderRecord,
  type AttestationInput,
  type BuilderRecord,
} from "@/lib/builder-record";

/**
 * The read behind a builder's record: the attestation registry for vaults that
 * have closed, the listings table for the ones still open.
 *
 * The risk pipeline and the public builder profile both read through here.
 */

/** The registry clamps a page to 100 (MAX_PAGE in blkfndr-attestation). */
const PAGE = 100;
/** A stop for a registry that never returns a short page. 10,000 closed vaults. */
const MAX_PAGES = 100;

type Listings = Parameters<typeof getProjects>[0];

/**
 * A builder's record, or null when it could not be read.
 *
 * Null is not "no history". A registry that did not answer returns null, so a
 * caller never shows, or scores, an unreadable record as a clean one. A builder
 * the registry has no entry for comes back with an empty `closed` list.
 *
 * Listings follow the caller: RLS decides which ones `client` may see, so a
 * public page passes a session-less client and gets public listings only. The
 * closed vaults come from the ledger and are public whatever the listing's
 * visibility, though without a title when the listing is not visible.
 */
export async function getBuilderRecord(
  builder: string,
  client?: Listings,
): Promise<BuilderRecord | null> {
  if (!isStellarAccount(builder)) return null;

  const registry = attestationClient();
  const attestations: AttestationInput[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE;
    const batch = await simulate(
      () => registry.get_builder_history({ builder, offset, limit: PAGE }),
      "get_builder_history",
    );
    if (batch === null) return null;
    attestations.push(...(batch as AttestationInput[]));
    // The registry skips an index whose record is missing, so a short page is
    // the only sign of the end; a full one may have more behind it.
    if (batch.length < PAGE) break;
  }

  const listings = await getProjects(client);
  return buildBuilderRecord(builder, attestations, listings);
}
