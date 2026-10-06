/**
 * A wallet's recent activity as sentences a person reads like a bank
 * statement: "Staked $25 in Solar Pump", "Collected $21.05 from Harbour Mill",
 * "Enabled dollars in your wallet". The raw operation (its type, the contract
 * function, the transaction reference) stays available for "Verify".
 *
 * Pure: takes the Horizon-derived item and a lookup from vault address to
 * project title, returns words. No network.
 */

import type { StellarAccountActivityItem } from "@/lib/stellar";
import { describeMoney, formatToken } from "@/lib/money";

export interface ActivityLine {
  /** "Staked $25 in Solar Pump". */
  sentence: string;
  /** The money that moved for this wallet, signed: "−$25.00", "+$21.05", or null. */
  amount: string | null;
  /** True when the network ran it and it did not go through. */
  failed: boolean;
}

function money(change: { asset: string; amount: string }, xlmUsd: number | null): string {
  const sign = change.amount.startsWith("-") ? "−" : "+";
  const units = Math.abs(parseFloat(change.amount));
  const view = describeMoney(units, change.asset, xlmUsd, "always");
  return `${sign}${view.primary}`;
}

function unsigned(change: { asset: string; amount: string }, xlmUsd: number | null): string {
  return describeMoney(Math.abs(parseFloat(change.amount)), change.asset, xlmUsd, "always").primary;
}

export function describeActivity(
  item: StellarAccountActivityItem,
  projectTitleByVault: (address: string | undefined) => string | null,
  xlmUsd: number | null = null,
): ActivityLine {
  const project = projectTitleByVault(item.contract_id);
  const where = project ? ` ${project}` : " a vault";
  // The change a sentence talks about: the asset that is not the fee.
  const main =
    item.changes.find((c) => c.asset !== "XLM") ?? item.changes[0] ?? null;
  const amount = main ? money(main, xlmUsd) : null;
  const failed = !item.successful;

  const say = (sentence: string): ActivityLine => ({ sentence, amount, failed });

  switch (item.contract_function) {
    case "contribute":
      return say(main ? `Staked ${unsigned(main, xlmUsd)} in${where}` : `Staked in${where}`);
    case "approve_milestone":
      return say(`Voted yes on a stage in${where}`);
    case "claim_refund":
      return say(main ? `Collected ${unsigned(main, xlmUsd)} from${where}` : `Collected a refund from${where}`);
    case "release_milestone":
      return say(`Sent an approved payout to the builder of${where}`);
    case "settle_lapsed_milestone":
      return say(`Closed a stage that failed its vote in${where}`);
    case "open_milestone_vote":
      return say(`Opened a stage vote in${where}`);
    case "settle":
      return say(`Recorded the deadline of${where}`);
    case "settle_stalled":
      return say(`Closed${where} after 90 quiet days`);
    case "return_bond":
      return say(main ? `Got the builder's deposit of ${unsigned(main, xlmUsd)} back from${where}` : `Got the builder's deposit back from${where}`);
    case "create_vault":
      return say("Opened a vault");
    case "transfer":
      if (main) {
        return say(main.amount.startsWith("-") ? `Sent ${unsigned(main, xlmUsd)}` : `Received ${unsigned(main, xlmUsd)}`);
      }
      return say("Moved money");
  }

  switch (item.type) {
    case "create_account":
      // In XLM, not dollars: a starting balance of practice XLM reads more
      // honestly as "10,000 XLM" than as a dollar figure.
      return {
        sentence:
          main && !main.amount.startsWith("-")
            ? `Wallet activated with ${formatToken(Math.abs(parseFloat(main.amount)), "XLM")}`
            : "Activated a wallet",
        amount: main ? `${main.amount.startsWith("-") ? "−" : "+"}${formatToken(Math.abs(parseFloat(main.amount)), "XLM")}` : null,
        failed,
      };
    case "change_trust":
      return say(/^Remove/i.test(item.label) ? "Turned off a currency in your wallet" : /USDC/.test(item.label) ? "Enabled dollars in your wallet" : "Enabled a currency in your wallet");
    case "payment":
    case "path_payment_strict_send":
    case "path_payment_strict_receive":
      if (main) {
        return say(main.amount.startsWith("-") ? `Sent ${unsigned(main, xlmUsd)}` : `Received ${unsigned(main, xlmUsd)}`);
      }
      return say("Payment");
    case "invoke_host_function":
      if (/Deploy contract/i.test(item.label)) return say("Opened a vault");
      return say(item.contract_function ? `${item.label} in${where}` : "An action on the network");
    default:
      return say(item.label);
  }
}
