/**
 * The browser side of fee sponsorship: offer the user's signed transaction to
 * /api/sponsor, and if BLKFNDR covers the fee, wait for the ledger.
 *
 * Every refusal, a network error or an unexpected answer comes back as
 * { sponsored: false }, and the caller submits the same signed transaction
 * itself, paying the fee from the user's wallet as it always did. That
 * self-paid path is the non-custodial rule's fallback: sponsorship can delay a
 * stake or a vote, never block one.
 *
 * Wired into toPrepared in src/hooks/use-stellar-contract.ts, the one submit
 * path the stake sheet and the vote panel share.
 *
 * Client-safe: no secrets, and the Stellar SDK is loaded only to wait for a
 * sponsored transaction.
 */

export type SponsorAttempt =
  | { sponsored: true; hash: string }
  | { sponsored: false; code: string; message: string | null };

/** The refusal the design names "Fee sponsorship is unavailable right now". */
export const SPONSOR_UNAVAILABLE_CODES = new Set(["disabled", "unavailable", "submit_rejected"]);

export async function requestSponsorship(
  signedXdr: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SponsorAttempt> {
  let res: Response;
  try {
    res = await fetchImpl("/api/sponsor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ xdr: signedXdr }),
    });
  } catch {
    return { sponsored: false, code: "network", message: null };
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // An answer that is not JSON is a refusal like any other.
  }

  const hash = body.hash;
  if (res.ok && typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash)) {
    return { sponsored: true, hash };
  }
  return {
    sponsored: false,
    code: typeof body.code === "string" ? body.code : `http_${res.status}`,
    message: typeof body.error === "string" ? body.error : null,
  };
}

/**
 * Wait for a sponsored transaction to reach a ledger. Returns the final status
 * (SUCCESS or FAILED). A transaction still not found after the wait throws an
 * error named TransactionStillPending, the SDK's own name, so explainError
 * words it as "sent, not yet confirmed".
 */
export async function waitForSponsored(hash: string): Promise<string> {
  const [{ rpc }, { SOROBAN_RPC_URL }] = await Promise.all([
    import("@stellar/stellar-sdk"),
    import("@/lib/stellar-clients"),
  ]);
  const final = await new rpc.Server(SOROBAN_RPC_URL).pollTransaction(hash, { attempts: 30 });
  if (final.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    const err = new Error(
      `Waited for transaction ${hash} to complete, but it did not. Check the transaction status manually.`,
    );
    err.name = "TransactionStillPending";
    throw err;
  }
  return final.status;
}
