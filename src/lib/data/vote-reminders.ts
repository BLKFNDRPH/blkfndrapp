import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { projectHref } from "@/lib/project-href";
import { closingTime } from "@/lib/data/vault-notifications";
import { emailColumns } from "@/lib/data/notifications";

/**
 * "One day left to vote": a reminder to each stakeholder who hasn't voted yet,
 * in the last day of a stage vote.
 *
 * Unlike the other vault notifications this isn't a ledger event, so it is
 * found by a scan, run every minute by the notification emails cron. Each
 * reminder is claimed in notification_once before it is created, so it is
 * produced once even though the scan keeps finding the same vote, and even if
 * the person dismisses it.
 *
 * Worked out from the indexed events, the same way "Needs you" is: who staked
 * (DEPOSIT/CONTRIB), who has voted on the stage (MILESTN/APPROVE), and whether
 * the stage is already decided (MILESTN/RELEASE or FAILED).
 */

const DAY = 86_400;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const payloadOf = (e: { payload: unknown }) => (Array.isArray(e.payload) ? (e.payload as unknown[]) : []);

export interface VoteRemindersResult {
  /** Reminders due this run, before the once-only check. */
  due: number;
  /** Reminders created this run. */
  created: number;
}

export async function queueVoteReminders(
  options: { dryRun?: boolean; now?: number } = {},
): Promise<VoteRemindersResult> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const admin = createAdminClient();

  // Votes closing within the day. A vote that opened less than a day ago is
  // skipped: its "up for your vote" notification is still fresh, and a second
  // message straight after it would be noise.
  const { data: opened, error } = await admin
    .from("contract_events")
    .select("contract_id, payload")
    .eq("topic1", "MILESTN")
    .eq("topic2", "VOTEOPEN");
  if (error) throw new Error(`Could not list open votes: ${error.message}`);

  const closing = (opened ?? [])
    .map((e) => {
      const p = payloadOf(e);
      return { vault: str(e.contract_id), stage: Number(p[1]), opensAt: Number(p[2]), closesAt: Number(p[3]) };
    })
    .filter((v) => v.vault && v.closesAt > now && v.closesAt - now <= DAY && now - v.opensAt >= DAY);
  if (closing.length === 0) return { due: 0, created: 0 };

  const vaults = [...new Set(closing.map((v) => v.vault))];
  const [{ data: events }, { data: projects }] = await Promise.all([
    admin
      .from("contract_events")
      .select("contract_id, topic1, topic2, payload")
      .in("contract_id", vaults)
      .in("topic1", ["MILESTN", "DEPOSIT"]),
    admin
      .from("projects")
      .select("id, project_id, title, status, creator_address, vault_address")
      .in("vault_address", vaults),
  ]);

  type Due = { key: string; wallet: string; userId?: string; projectId: string; title: string; caption: string; url: string };
  const due: Due[] = [];

  for (const vote of closing) {
    const project = (projects ?? []).find((p) => p.vault_address === vote.vault);
    if (!project || (project.status !== "funded" && project.status !== "active")) continue;
    const mine = (events ?? []).filter((e) => e.contract_id === vote.vault);

    const decided = mine.some(
      (e) =>
        e.topic1 === "MILESTN" &&
        (e.topic2 === "RELEASE" || e.topic2 === "FAILED") &&
        Number(payloadOf(e)[1]) === vote.stage,
    );
    if (decided) continue;

    const voted = new Set(
      mine
        .filter((e) => e.topic1 === "MILESTN" && e.topic2 === "APPROVE" && Number(payloadOf(e)[1]) === vote.stage)
        .map((e) => str(payloadOf(e)[2])),
    );
    const builderWallet = str(project.creator_address);
    const waiting = [
      ...new Set(
        mine
          .filter((e) => e.topic1 === "DEPOSIT" && e.topic2 === "CONTRIB")
          .map((e) => str(payloadOf(e)[1]))
          .filter((w) => w && !voted.has(w) && w !== builderWallet),
      ),
    ];

    const name = project.title || `Project #${project.project_id}`;
    for (const wallet of waiting) {
      due.push({
        key: `vote-reminder:${vote.vault}:${vote.stage}:${vote.closesAt}:${wallet}`,
        wallet,
        projectId: project.id,
        title: `One day left to vote on Stage ${vote.stage} of ${name}`,
        caption: `Voting closes on ${closingTime(vote.closesAt)}, and you haven't voted yet. If the payout doesn't get enough yes votes by then, the stage fails and what's left in the vault comes back to stakeholders.`,
        url: projectHref(project.project_id, { tab: "stages" }),
      });
    }
  }

  // Only people whose wallet is set up on an account can be reached.
  const wallets = [...new Set(due.map((d) => d.wallet))];
  if (wallets.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, stellar_public_key").in("stellar_public_key", wallets);
    const byWallet = new Map((profiles ?? []).map((p) => [str(p.stellar_public_key), str(p.id)]));
    for (const d of due) d.userId = byWallet.get(d.wallet);
  }
  const reachable = due.filter((d) => d.userId);
  if (options.dryRun || reachable.length === 0) return { due: reachable.length, created: 0 };

  // Claim each reminder. Only keys this run inserted come back, so a reminder
  // already produced -- by an earlier run, or one running alongside -- is not
  // produced again.
  const { data: claimed, error: claimError } = await admin
    .from("notification_once")
    .upsert(
      reachable.map((d) => ({ key: d.key })),
      { onConflict: "key", ignoreDuplicates: true },
    )
    .select("key");
  if (claimError) throw new Error(`Could not claim vote reminders: ${claimError.message}`);
  const fresh = new Set((claimed ?? []).map((c) => str(c.key)));
  const rows = reachable.filter((d) => fresh.has(d.key));
  if (rows.length === 0) return { due: reachable.length, created: 0 };

  const { error: insertError } = await admin.from("notifications").insert(
    rows.map((d) => ({
      user_id: d.userId as string,
      title: d.title.slice(0, 200),
      caption: d.caption.slice(0, 1000),
      url: d.url,
      project_id: d.projectId,
      ...emailColumns("votes"),
    })),
  );
  if (insertError) {
    // The claims stand, so these reminders are lost rather than sent twice.
    console.error("[vote-reminders] Could not create reminders:", insertError.message);
    return { due: reachable.length, created: 0 };
  }
  return { due: reachable.length, created: rows.length };
}
