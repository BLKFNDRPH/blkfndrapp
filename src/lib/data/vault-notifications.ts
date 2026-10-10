import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { projectHref } from "@/lib/project-href";
import { describeMoney, rawToUnits } from "@/lib/money";
import { emailColumns } from "@/lib/data/notifications";
import type { EmailCategory } from "@/lib/email/categories";

/**
 * Tell people when a vault does something they need to know: a vote they can
 * take part in has opened, money has been paid out, money is waiting for them
 * to collect. Without this, a stakeholder learned a vote had opened only by
 * revisiting the project, and a seven-day window could pass unseen.
 *
 * Called by the indexer for each event it handles, after the vault is
 * re-synced. An event is handled until one attempt succeeds, and a failed
 * attempt fails in that re-sync, before this runs, so an event notifies once.
 * The exception is an attempt that dies after notifying but before it is marked
 * handled: the retry notifies again. History is never replayed into anyone's
 * bell, because the indexer only handles events as it first reads them, or
 * retries them shortly after.
 *
 * Only people whose wallet is set up on a BLKFNDR account can be reached: the
 * ledger names wallets, and an account is the only way to a person.
 */

type Row = { user_id: string; title: string; caption: string; url: string; project_id: string; email: EmailCategory };

const RELEVANT = new Set([
  "MILESTN/VOTEOPEN",
  "MILESTN/RELEASE",
  "MILESTN/FAILED",
  "VAULT/FUNDED",
  "VAULT/FAILED",
  "VAULT/STALLED",
  "DEPOSIT/CONTRIB",
  "BOND/RETURNED",
]);

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * "Thu 14 Oct at 14:00 UTC". Emails can't know the reader's time zone, so the
 * time is in UTC and says so.
 */
export function closingTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day.replace(",", "")} at ${time} UTC`;
}

/** Account ids for wallets, skipping wallets no account has set up. */
async function accountsFor(admin: ReturnType<typeof createAdminClient>, wallets: string[]): Promise<Map<string, string>> {
  if (wallets.length === 0) return new Map();
  const { data } = await admin.from("profiles").select("id, stellar_public_key").in("stellar_public_key", wallets);
  return new Map((data ?? []).map((p) => [String(p.stellar_public_key), String(p.id)]));
}

export async function notifyForVaultEvent(key: string, payload: unknown[], vault: string): Promise<number> {
  if (!RELEVANT.has(key)) return 0;
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, project_id, title, currency, creator_address, funding_goal_raw, current_funding_raw")
    .eq("vault_address", vault)
    .maybeSingle();
  if (!project) return 0;

  const title = project.title || `Project #${project.project_id}`;
  const money = (raw: unknown) => {
    try {
      return describeMoney(rawToUnits(BigInt(str(raw) || "0")), project.currency ?? "USDC", null, "auto").primary;
    } catch {
      return "";
    }
  };
  const stages = projectHref(project.project_id, { tab: "stages" });
  const page = projectHref(project.project_id);

  // Everyone who has staked in this vault, from its recorded stakes.
  const { data: stakes } = await admin
    .from("contract_events")
    .select("payload")
    .eq("contract_id", vault)
    .eq("topic1", "DEPOSIT")
    .eq("topic2", "CONTRIB");
  const stakers = [...new Set((stakes ?? []).map((s) => str((s.payload as unknown[])?.[1])).filter(Boolean))];
  const builderWallet = str(project.creator_address);
  const accounts = await accountsFor(admin, [...stakers, builderWallet].filter(Boolean));
  const builder = accounts.get(builderWallet) ?? null;
  // A builder who also staked hears the builder's version once, not both.
  const stakeholders = stakers.map((w) => accounts.get(w)).filter((id): id is string => Boolean(id) && id !== builder);

  // Each message is also emailed, under the switch that covers it: a vote that
  // needs them, money waiting for them, or a receipt.
  const rows: Row[] = [];
  const toStakeholders = (title_: string, caption: string, url: string, email: EmailCategory) =>
    stakeholders.forEach((user_id) => rows.push({ user_id, title: title_, caption, url, project_id: project.id, email }));
  const toBuilder = (title_: string, caption: string, url: string) => {
    if (builder) rows.push({ user_id: builder, title: title_, caption, url, project_id: project.id, email: "updates" });
  };

  const stage = Number(payload[1]);
  switch (key) {
    case "MILESTN/VOTEOPEN": {
      const days = Math.round((Number(payload[3]) - Number(payload[2])) / 86_400) || 7;
      toStakeholders(
        `Stage ${stage} of ${title} is up for your vote`,
        `Voting closes in ${days} days, on ${closingTime(Number(payload[3]))}. The builder is paid for this stage only if enough stakeholders vote yes.`,
        stages,
        "votes",
      );
      break;
    }
    case "MILESTN/RELEASE": {
      const amount = money(payload[2]);
      toStakeholders(
        `${amount} paid to the builder of ${title}`,
        `Stakeholders approved Stage ${stage}, and the vault paid it out.`,
        stages,
        "updates",
      );
      toBuilder(`You were paid ${amount} for Stage ${stage} of ${title}`, "Stakeholders approved the stage, and the vault paid you.", stages);
      break;
    }
    case "MILESTN/FAILED":
      toStakeholders(
        `Money is waiting for you from ${title}`,
        `The Stage ${stage} vote ended short of a majority, so refunds are open, with a share of the builder's deposit. Collect yours from the project page.`,
        page,
        "refunds",
      );
      toBuilder(
        `Stage ${stage} of ${title} didn't pass its vote`,
        "Refunds are open to stakeholders, and your deposit is shared among them.",
        stages,
      );
      break;
    case "VAULT/STALLED":
      toStakeholders(
        `Money is waiting for you from ${title}`,
        "Nothing moved for 90 days, so the vault closed and refunds opened. Collect yours from the project page.",
        page,
        "refunds",
      );
      toBuilder(`${title} was closed after 90 quiet days`, "Refunds are open to stakeholders, and your deposit is shared among them.", page);
      break;
    case "VAULT/FAILED":
      toStakeholders(
        `Your stake in ${title} is ready to come back to you`,
        "The deadline passed before the goal was reached, so everyone who staked can collect their stake in full.",
        page,
        "refunds",
      );
      toBuilder(`${title} didn't reach its goal`, "Stakes go back to stakeholders, and your deposit isn't forfeited.", page);
      break;
    case "VAULT/FUNDED":
      toStakeholders(
        `${title} reached its ${money(payload[1])} goal`,
        "Stakes are closed. The builder is starting, and you'll vote on each payout.",
        page,
        "updates",
      );
      toBuilder(
        `${title} reached its ${money(payload[1])} goal`,
        "Stakes are closed. Open the first stage vote when you're ready to be paid for it.",
        stages,
      );
      break;
    case "DEPOSIT/CONTRIB":
      toBuilder(
        `New stake in ${title}: ${money(payload[2])}`,
        `${money(payload[3])} staked so far, of a ${money(project.funding_goal_raw)} goal.`,
        page,
      );
      break;
    case "BOND/RETURNED":
      // Sent when the last stage is paid, and by return_bond after a missed
      // goal; either way the deposit is back in the builder's wallet.
      toBuilder(`Your ${money(payload[1])} deposit came back from ${title}`, "The vault returned it to your wallet.", page);
      break;
  }

  if (rows.length === 0) return 0;
  const { error } = await admin.from("notifications").insert(
    rows.map(({ email, ...r }) => ({
      ...r,
      title: r.title.slice(0, 200),
      caption: r.caption.slice(0, 1000),
      ...emailColumns(email),
    })),
  );
  if (error) {
    // A notification must never fail the indexing that produced it.
    console.error(`[notifications] Could not notify for ${key} on ${vault}:`, error.message);
    return 0;
  }
  return rows.length;
}
