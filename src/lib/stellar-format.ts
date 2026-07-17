// Decimal places per currency type.
// Stellar assets use 7 decimals
const COIN_DECIMALS: Record<string, number> = {
  USDC: 7,
  USDT: 7,
  XLM: 7,
  WBTC: 7,
  WETH: 7,
};

const getDecimals = (currency?: string): number =>
  COIN_DECIMALS[(currency ?? "XLM").toUpperCase()] ?? 7;

export const StellarFormatter = {
  /**
   * Converts a raw on-chain amount to its human-readable equivalent.
   */
  toStellar: (raw: string | number | undefined, currency?: string): number => {
    if (raw === undefined) return 0;
    const amount = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (isNaN(amount)) return 0;
    return amount / Math.pow(10, getDecimals(currency));
  },

  /**
   * Converts a human-readable amount back to raw on-chain units.
   * e.g. toRaw(1.5, 'USDC') → 15_000_000
   */
  toRaw: (human: number, currency?: string): number => {
    return Math.floor(human * Math.pow(10, getDecimals(currency)));
  },

  /**
   * Formats a raw amount into a human-readable string.
   */
  format: (
    raw: string | number | undefined,
    decimals: number = 2,
    currency?: string,
  ): string => {
    return StellarFormatter.toStellar(raw, currency).toLocaleString(undefined, {
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
    return `${StellarFormatter.format(raw, decimals, currency)} ${currency.toUpperCase()}`;
  },

  /**
   * Checks if a project is fully funded based on raw on-chain values.
   */
  isFullyFunded: (
    raised: string | undefined,
    goal: string | undefined,
  ): boolean => {
    if (raised === undefined || goal === undefined) return false;
    return parseInt(raised, 10) >= parseInt(goal, 10);
  },

  /**
   * Calculates the remaining raw on-chain units needed to reach the goal.
   * Returns a string in raw units (not human-readable).
   */
  getRemaining: (
    raised: string | undefined,
    goal: string | undefined,
  ): string => {
    if (raised === undefined || goal === undefined) return "0";
    return Math.max(0, parseInt(goal, 10) - parseInt(raised, 10)).toString();
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
