/**
 * Dollars first, tokens on request.
 *
 * A stakeholder thinks in dollars. The vault counts USDC or XLM. These helpers
 * turn a vault amount into the figure a person reads first ("$3,200") and the
 * exact figure the vault holds ("3,200 USDC"), so every screen shows the same
 * thing the same way.
 *
 * USDC is a dollar: the primary figure is exact and carries no "≈".
 * XLM moves against the dollar: the primary figure is an estimate at the rate
 * the caller passes in (see useXlmRate), marked "≈", and the XLM figure is the
 * one the vault actually counts. With no rate at all, the XLM figure is shown
 * on its own rather than a guessed dollar amount.
 *
 * Pure functions, no React, safe on the server.
 */

export type MoneyView = {
  /** What a person reads first: "$3,200", "≈ $480", or "3,200 XLM" with no rate. */
  primary: string;
  /** The exact vault figure, when it differs from the primary: "3,200 USDC". */
  secondary?: string;
  /** True when the primary figure is an estimate. */
  approx: boolean;
};

export type CentsRule = "auto" | "always" | "never";

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const tokenWhole = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const tokenCents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function wantsCents(amount: number, rule: CentsRule): boolean {
  if (rule === "always") return true;
  if (rule === "never") return false;
  return Math.abs(amount - Math.round(amount)) >= 0.005;
}

/** "$3,200" or "$50.00". Cents show when the amount has them ("auto"). */
export function formatUsd(amount: number, cents: CentsRule = "auto"): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return wantsCents(safe, cents) ? usdCents.format(safe) : usdWhole.format(safe);
}

/** "3,200 USDC" or "166.42 XLM". */
export function formatToken(
  amount: number,
  currency: string | undefined,
  cents: CentsRule = "auto",
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const code = (currency || "").toUpperCase();
  const figure = wantsCents(safe, cents)
    ? tokenCents.format(safe)
    : tokenWhole.format(safe);
  return code ? `${figure} ${code}` : figure;
}

/** True for the dollar-pegged tokens a vault can hold. */
export function isDollarToken(currency: string | undefined): boolean {
  const code = (currency || "").toUpperCase();
  return code === "USDC" || code === "USDT";
}

/**
 * The two-line view of a vault amount.
 *
 * @param amount   the amount in whole tokens (not stroops)
 * @param currency the vault's token code, "USDC" or "XLM"
 * @param xlmUsd   dollars per XLM, or null when no rate is available
 */
export function describeMoney(
  amount: number,
  currency: string | undefined,
  xlmUsd: number | null | undefined = null,
  cents: CentsRule = "auto",
): MoneyView {
  const code = (currency || "USDC").toUpperCase();

  if (isDollarToken(code)) {
    return {
      primary: formatUsd(amount, cents),
      secondary: formatToken(amount, code, cents),
      approx: false,
    };
  }

  if (code === "XLM" && xlmUsd && xlmUsd > 0) {
    // An estimate with cents reads as precision it does not have, so a dollar
    // figure derived from a moving rate is always whole dollars, unless the
    // caller insists (a stake sheet showing "≈ $4.98" for a $5 minimum).
    return {
      primary: `≈ ${formatUsd(amount * xlmUsd, cents === "always" ? "always" : "never")}`,
      secondary: formatToken(amount, code, cents),
      approx: true,
    };
  }

  // No rate, or a token this build has no dollar figure for: show the exact
  // vault figure rather than invent a dollar amount.
  return { primary: formatToken(amount, code, cents), approx: true };
}

/**
 * "$3,200 of $5,000 staked" as one string, with the XLM figures appended when
 * the vault counts XLM: "≈ $480 of ≈ $750 staked (3,200 of 5,000 XLM)".
 */
export function describeProgress(
  raised: number,
  goal: number,
  currency: string | undefined,
  xlmUsd: number | null | undefined = null,
): { line: string; approx: boolean } {
  const code = (currency || "USDC").toUpperCase();
  if (isDollarToken(code)) {
    return {
      line: `${formatUsd(raised)} of ${formatUsd(goal)} staked`,
      approx: false,
    };
  }
  if (code === "XLM" && xlmUsd && xlmUsd > 0) {
    return {
      line: `≈ ${formatUsd(raised * xlmUsd, "never")} of ≈ ${formatUsd(goal * xlmUsd, "never")} staked (${tokenWhole.format(raised)} of ${tokenWhole.format(goal)} XLM)`,
      approx: true,
    };
  }
  return {
    line: `${tokenWhole.format(raised)} of ${formatToken(goal, code)} staked`,
    approx: true,
  };
}

/** How long a rate has been sitting in the cache, in words. */
export function describeRateAge(updatedAt: number | null | undefined, now = Date.now()): string {
  if (!updatedAt) return "rate unavailable";
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60_000));
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `updated ${hours} h ago`;
}
