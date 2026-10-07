import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller } from "@/lib/supabase/auth";
import { projectHref } from "@/lib/project-href";

/**
 * What needs the signed-in person right now: votes open in vaults they hold a
 * stake in that they haven't cast, and money waiting for them to collect.
 *
 * Worked out from the indexed ledger events rather than from notifications, so
 * it stays true after a notification is read or dismissed, and an item goes
 * away by itself once they vote, collect, or the window closes. Keyed on the
 * wallet set up on their account, the one their stakes were made from.
 */

export type Decision =
  | {
      kind: "vote";
      projectNumber: string;
      title: string;
      stage: number;
      /** When the vote closes, epoch seconds. */
      closesAt: number;
      href: string;
    }
  | {
      kind: "collect";
      projectNumber: string;
      title: string;
      href: string;
    };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export async function getOwnDecisions(now = Math.floor(Date.now() / 1000)): Promise<Decision[]> {
  const caller = await requireCaller();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("stellar_public_key")
    .eq("id", caller.userId)
    .maybeSingle();
  const wallet = str(profile?.stellar_public_key);
  if (!wallet) return [];

  const admin = createAdminClient();
  // The vaults this wallet staked in.
  const { data: staked } = await admin
    .from("contract_events")
    .select("contract_id")
    .eq("topic1", "DEPOSIT")
    .eq("topic2", "CONTRIB")
    .contains("payload", JSON.stringify([wallet]));
  const vaults = [...new Set((staked ?? []).map((r) => str(r.contract_id)).filter(Boolean))];
  if (vaults.length === 0) return [];

  const [{ data: events }, { data: projects }] = await Promise.all([
    admin
      .from("contract_events")
      .select("contract_id, topic1, topic2, payload")
      .in("contract_id", vaults)
      .in("topic1", ["MILESTN", "DEPOSIT"]),
    admin.from("projects").select("project_id, title, status, vault_address").in("vault_address", vaults),
  ]);

  const out: Decision[] = [];
  for (const project of projects ?? []) {
    const vault = str(project.vault_address);
    const mine = (events ?? []).filter((e) => e.contract_id === vault);
    const title = project.title || `Project #${project.project_id}`;
    const payloadOf = (e: { payload: unknown }) => (Array.isArray(e.payload) ? e.payload : []);

    // Money waiting: the vault is returning money and this wallet hasn't
    // collected yet. The ledger, not the status label, decides a refund; the
    // label is what the indexer read from it.
    if (project.status === "failed" || project.status === "refunding") {
      const collected = mine.some(
        (e) => e.topic1 === "DEPOSIT" && e.topic2 === "REFUND" && str(payloadOf(e)[1]) === wallet,
      );
      if (!collected) {
        out.push({ kind: "collect", projectNumber: project.project_id, title, href: projectHref(project.project_id) });
      }
      continue;
    }

    if (project.status !== "funded" && project.status !== "active") continue;

    // Votes open now, on a stage not yet decided, that this wallet hasn't cast.
    const settled = new Set(
      mine
        .filter((e) => e.topic1 === "MILESTN" && (e.topic2 === "RELEASE" || e.topic2 === "FAILED"))
        .map((e) => Number(payloadOf(e)[1])),
    );
    const voted = new Set(
      mine
        .filter((e) => e.topic1 === "MILESTN" && e.topic2 === "APPROVE" && str(payloadOf(e)[2]) === wallet)
        .map((e) => Number(payloadOf(e)[1])),
    );
    for (const e of mine) {
      if (e.topic1 !== "MILESTN" || e.topic2 !== "VOTEOPEN") continue;
      const p = payloadOf(e);
      const stage = Number(p[1]);
      const closesAt = Number(p[3]);
      if (!(closesAt > now) || settled.has(stage) || voted.has(stage)) continue;
      out.push({
        kind: "vote",
        projectNumber: project.project_id,
        title,
        stage,
        closesAt,
        href: projectHref(project.project_id, { tab: "stages" }),
      });
    }
  }

  // Soonest deadline first; money waiting after the votes.
  return out.sort((a, b) =>
    a.kind === "vote" && b.kind === "vote" ? a.closesAt - b.closesAt : a.kind === "vote" ? -1 : b.kind === "vote" ? 1 : 0,
  );
}
