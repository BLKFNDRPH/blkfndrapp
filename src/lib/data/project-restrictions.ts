import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller } from "@/lib/supabase/auth";
import { notify } from "@/lib/data/notifications";
import type { ProjectRestriction } from "@/lib/types";

/**
 * Hiding and locking a project: the platform's controls over its own surface.
 *
 * Neither reaches the vault. The contract has no pause switch and no admin key,
 * and nothing here pretends otherwise — a hidden project's vault keeps working,
 * and a locked one can still be called by anyone who assembles the transaction
 * by hand. What these change is what this platform lists and which
 * transactions its interface will build.
 *
 * The rules live in Postgres (20261001120000_project_restrictions.sql): who may
 * restrict, the required reason, the audit entry, who can still see a hidden
 * listing, and the refusal of milestone proof under a lock. This module adds
 * readable errors and the builder's notification — nothing a caller could skip
 * to get around the rules.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Named, never "*": hidden_by and locked_by are granted to no browser role, and
// a select that named them would be refused outright.
const COLUMNS = "vault_address, hidden_at, hidden_reason, locked_at, locked_reason";

interface RestrictionRow {
  vault_address: string;
  hidden_at: string | null;
  hidden_reason: string;
  locked_at: string | null;
  locked_reason: string;
}

function toRestriction(row: RestrictionRow): ProjectRestriction {
  return {
    hidden: row.hidden_at !== null,
    hiddenAt: row.hidden_at,
    hiddenReason: row.hidden_reason,
    locked: row.locked_at !== null,
    lockedAt: row.locked_at,
    lockedReason: row.locked_reason,
  };
}

/**
 * Every restriction the caller may see, by vault address.
 *
 * Unfiltered on purpose. The table holds a row only for a restricted project,
 * so it stays small, and RLS already narrows it to projects the caller can see;
 * filtering by vault instead would put every address on the platform into one
 * request URL.
 *
 * Never throws. A listing page that failed because restrictions could not be
 * read would turn a moderation lookup into an outage — including in the window
 * where this code is deployed before its migration. A hidden listing stays
 * hidden regardless, because RLS on projects enforces that, not this map. The
 * failure is logged, because an absent restriction reads as "unrestricted".
 */
export async function getRestrictionMap(
  supabase?: Supabase,
): Promise<Map<string, ProjectRestriction>> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.from("project_restrictions").select(COLUMNS);

  if (error) {
    console.error("[restrictions] Could not read project restrictions:", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.vault_address, toRestriction(row)]));
}

/** One project's restriction, or null when it has none or the caller cannot see it. */
export async function getRestriction(
  vaultAddress: string,
  supabase?: Supabase,
): Promise<ProjectRestriction | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("project_restrictions")
    .select(COLUMNS)
    .eq("vault_address", vaultAddress)
    .maybeSingle();

  if (error) {
    console.error("[restrictions] Could not read restriction for", vaultAddress, error.message);
    return null;
  }
  return data ? toRestriction(data) : null;
}

/**
 * Whether a vault is locked, asked fresh — immediately before the interface
 * builds a stake or opens a milestone vote, rather than trusting a listing that
 * may be minutes old. Answers for any vault, signed in or not: a lock is public
 * by design, and this reveals only the yes or no.
 *
 * Null when the question could not be answered, which is not the same as no.
 */
export async function isVaultLocked(vaultAddress: string): Promise<boolean | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("project_is_locked", { vault: vaultAddress });
  if (error) {
    console.error("[restrictions] Could not check the lock on", vaultAddress, error.message);
    return null;
  }
  return data === true;
}

/**
 * Hide or unhide a project.
 *
 * Through the caller's own session, so the database decides whether they may:
 * set_project_hidden checks the role, records them as the actor and writes the
 * audit entry in the same transaction. Its refusals are written to be shown as
 * they are.
 */
export async function setProjectHidden(vaultAddress: string, hidden: boolean, reason: string) {
  await requireCaller();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_project_hidden", {
    vault: vaultAddress,
    hide: hidden,
    reason,
  });
  if (error) throw new Error(error.message);

  await tellBuilder(vaultAddress, hidden ? "hidden" : "unhidden", reason);
}

/** Lock or unlock a project. Same shape, same gate, as setProjectHidden. */
export async function setProjectLocked(vaultAddress: string, locked: boolean, reason: string) {
  await requireCaller();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_project_locked", {
    vault: vaultAddress,
    lock: locked,
    reason,
  });
  if (error) throw new Error(error.message);

  await tellBuilder(vaultAddress, locked ? "locked" : "unlocked", reason);
}

/**
 * Tell the builder what happened to their project, and why.
 *
 * Without it a hidden project simply vanishes from the site and a locked one
 * stops taking stakes, and the builder's only explanation is whatever they
 * guess. Service role, because the recipient is not the caller.
 *
 * Best-effort, like every notification: the restriction already stands, and a
 * builder whose wallet is linked to no account has no inbox here to reach.
 */
async function tellBuilder(
  vaultAddress: string,
  change: "hidden" | "unhidden" | "locked" | "unlocked",
  reason: string,
) {
  try {
    const admin = createAdminClient();
    const { data: project } = await admin
      .from("projects")
      .select("id, title, creator_address")
      .eq("vault_address", vaultAddress)
      .maybeSingle();
    if (!project) return;

    const { data: builder } = await admin
      .from("profiles")
      .select("id")
      .eq("stellar_public_key", project.creator_address)
      .maybeSingle();
    if (!builder) return;

    // Trailing punctuation dropped so a reason ending in a full stop does not
    // print two of them.
    const why = reason.trim().replace(/[.\s]+$/, "");
    const message = {
      hidden: {
        title: `"${project.title}" is hidden from public listings`,
        caption: `${why ? `Reason: ${why}. ` : ""}You and its stakeholders can still open it, and its vault is unaffected.`,
      },
      unhidden: {
        title: `"${project.title}" is public again`,
        caption: "It is back on explore, search and the home page.",
      },
      locked: {
        title: `"${project.title}" is locked by the platform`,
        caption: `${why ? `Reason: ${why}. ` : ""}New stakes, opening milestone votes and proof submission are paused until it is unlocked. Refunds and stakeholder votes are unaffected.`,
      },
      unlocked: {
        title: `"${project.title}" is unlocked`,
        caption: "New stakes, milestone votes and proof submission are open again.",
      },
    }[change];

    await notify({
      userId: builder.id,
      title: message.title,
      caption: message.caption,
      url: "/profile?tab=projects",
      projectId: project.id,
    });
  } catch (err) {
    console.error("[restrictions] Could not notify the builder of", vaultAddress, err);
  }
}
