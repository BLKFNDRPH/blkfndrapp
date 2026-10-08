/**
 * Why a launch was refused, in words a builder can act on.
 *
 * A failed `create_vault` comes back as a host error and an event log, and the
 * number on top is not the answer. The factory calls the new vault, which
 * calls the token contract to take the bond, and each passes the innermost
 * error number up unchanged: a bond the wallet cannot cover arrives as
 * `HostError: Error(Contract, #10)` even though #10 is the token's balance
 * error, and #10 in our own vault means AlreadyInitialized. So the number is
 * read alongside the contract that raised it first -- the deepest error event
 * in the log -- and never on its own.
 *
 * The token contract's words are matched too, because they are what the
 * network actually says (read from testnet simulations, Oct 2026):
 *   #13 "trustline entry is missing for account"
 *   #10 "resulting balance is not within the allowed range"
 */

/** One error event from a host diagnostic log. */
export interface ContractError {
  contract: string;
  code: number;
  /** The event's data, e.g. the token contract's explanation. */
  data: string;
}

const ERROR_EVENT =
  /^\s*(\d+): \[(?:Failed )?Diagnostic Event[^\]]*\] contract:(C[A-Z2-7]{55}), topics:\[error, Error\(Contract, #(\d+)\)\], data:(.*)$/;

/**
 * The error the failing call started from: the deepest error event in the
 * log. The SDK prints the log newest first, so that is the highest index.
 */
export function innermostContractError(text: string): ContractError | null {
  let deepest: (ContractError & { index: number }) | null = null;
  for (const line of text.split("\n")) {
    const m = ERROR_EVENT.exec(line);
    if (!m) continue;
    const index = Number(m[1]);
    if (!deepest || index > deepest.index) {
      deepest = { index, contract: m[2], code: Number(m[3]), data: m[4] };
    }
  }
  if (!deepest) return null;
  const { contract, code, data } = deepest;
  return { contract, code, data };
}

export type LaunchFailure =
  /** The wallet cannot hold, or does not hold enough of, the vault's asset. */
  | { kind: "token"; reason: "no-trustline" | "insufficient" | "no-account" }
  /** One of the platform's rules refused the launch; `message` says which. */
  | { kind: "rule"; message: string }
  /** The network could not be reached or did not answer. */
  | { kind: "network" }
  | { kind: "unknown" };

/** Factory errors a launch can meet (contracts/blkfndr-factory/src/lib.rs). */
const FACTORY_RULES: Record<number, string> = {
  1: "This wallet isn't allowed to make that change.",
  12: "Your deposit is below the minimum. Raise it to at least the minimum shown on the form.",
  13: "Something in this listing doesn't meet the vault contract's rules, such as the goal, the stages or the deadline. Check the form and try again.",
};

/** Vault errors raised while a new vault sets itself up (contracts/blkfndr-vault/src/lib.rs). */
const VAULT_RULES: Record<number, string> = {
  6: "Something in this listing doesn't meet the vault contract's rules, such as the goal, the stages or the deadline. Check the form and try again.",
  7: "The deadline has to be in the future.",
  12: "Your identity verification isn't active on-chain for this wallet. Check it on your profile, then try again.",
};

const NEW_VAULT = /topics:\[fn_call, (C[A-Z2-7]{55}), initialize\]/;

const NETWORK_TROUBLE =
  /(failed to fetch|network ?error|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|50[234]\b|service unavailable)/i;

/**
 * Classify a refused launch from the error text the SDK or the network gave.
 * `tokenAddress` is the vault's asset; `factoryId` the factory that was called.
 */
export function classifyLaunchFailure(
  text: string,
  tokenAddress: string,
  factoryId: string,
): LaunchFailure {
  const origin = innermostContractError(text);

  if (origin?.contract === tokenAddress) {
    if (origin.code === 13 || /trustline entry is missing/i.test(origin.data)) {
      return { kind: "token", reason: "no-trustline" };
    }
    if (/account entry is missing/i.test(origin.data)) {
      return { kind: "token", reason: "no-account" };
    }
    if (origin.code === 10 || /balance is not within the allowed range|insufficient/i.test(origin.data)) {
      return { kind: "token", reason: "insufficient" };
    }
  }
  if (origin?.contract === factoryId && FACTORY_RULES[origin.code]) {
    return { kind: "rule", message: FACTORY_RULES[origin.code] };
  }
  // The vault being created has no address until the call runs; the log names
  // it as the contract the factory called `initialize` on.
  const vault = NEW_VAULT.exec(text)?.[1];
  if (origin && vault && origin.contract === vault && VAULT_RULES[origin.code]) {
    return { kind: "rule", message: VAULT_RULES[origin.code] };
  }

  // No event log: an error raised before or around the call itself.
  if (!origin) {
    if (/trustline entry is missing/i.test(text)) return { kind: "token", reason: "no-trustline" };
    if (/account not found|account entry is missing/i.test(text)) return { kind: "token", reason: "no-account" };
    if (NETWORK_TROUBLE.test(text)) return { kind: "network" };
  }
  return { kind: "unknown" };
}

/** The first line of a raw error, trimmed for a "Technical details" fold. */
export function technicalDetail(text: string, max = 300): string {
  const first = text.split("\n").find((line) => line.trim() !== "") ?? text;
  return first.length > max ? `${first.slice(0, max)}…` : first;
}
