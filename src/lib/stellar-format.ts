// Every Stellar asset carries 7 decimal places, so this is a constant rather
// than a per-currency table. The old table listed five currencies and returned 7
// for all of them.
const DECIMALS = 7;

export const StellarFormatter = {
  /**
   * Converts a raw on-chain amount to its human-readable equivalent.
   */
  toStellar: (raw: string | number | undefined): number => {
    if (raw === undefined) return 0;
    const amount = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (isNaN(amount)) return 0;
    return amount / Math.pow(10, DECIMALS);
  },

  /**
   * Formats a raw amount into a human-readable string.
   */
  format: (raw: string | number | undefined, decimals: number = 2): string => {
    return StellarFormatter.toStellar(raw).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  /**
   * Formats a raw amount and appends the currency label.
   * e.g. "1,234.56 XLM"
   */
  formatWithLabel: (
    raw: string | number | undefined,
    decimals: number = 2,
    currency: string = "XLM",
  ): string => {
    return `${StellarFormatter.format(raw, decimals)} ${currency.toUpperCase()}`;
  },

  /**
   * Calculates the funding percentage (0–100).
   */
  getPercentage: (
    raised: string | undefined,
    goal: string | undefined,
  ): number => {
    if (raised === undefined || goal === undefined) return 0;
    const r = parseInt(raised, 10);
    const g = parseInt(goal, 10);
    if (g === 0) return 0;
    return Math.min((r / g) * 100, 100);
  },
};
