/**
 * Accepted currencies and their Stellar Asset Contract addresses.
 *
 * The old crowdfunding contract carried a `CurrencyType` enum and an on-chain
 * token registry the admin wrote to. The vault does not: it takes a token
 * address at construction and uses that one for its whole life. That is
 * deliberate — an admin who can repoint a currency after funds are escrowed can
 * make a refund pay out in a different asset than was deposited.
 *
 * So the mapping lives here, in app configuration, and only decides which token
 * address a new project is created with.
 */

/**
 * USDT, WBTC and WETH were listed here but have no canonical issuer on Stellar,
 * which carries USDC, EURC, YLDS and MGUSD as native issued assets. There was
 * no address to configure them with, so they could never have worked — and a
 * guessed or unvetted issuer address is worse than an absent one, because it
 * escrows real contributions into an asset nobody chose.
 *
 * The database enum still accepts them. It is a superset of this list, which is
 * assignable and harmless, and it means restoring one is a config change rather
 * than a migration if an issuer ever exists.
 */
export const CURRENCIES = ["USDC", "XLM"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Stellar assets carry 7 decimal places. */
export const STROOPS_PER_UNIT = 10_000_000n;

const TOKEN_ADDRESSES: Record<Currency, string | undefined> = {
  XLM: process.env.NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID,
  USDC: process.env.NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID,
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Token contract address for a currency.
 * Throws rather than returning undefined: a project created against an empty
 * token address would build a vault nobody can contribute to, and failing at
 * the point of misconfiguration is far easier to diagnose.
 */
export function tokenAddressFor(currency: Currency): string {
  const address = TOKEN_ADDRESSES[currency];
  if (!address) {
    throw new Error(
      `No token contract configured for ${currency}. ` +
        `Set NEXT_PUBLIC_STELLAR_${currency}_TOKEN_ID.`,
    );
  }
  return address;
}

/** Currencies that are actually usable given the current configuration. */
export function availableCurrencies(): Currency[] {
  return CURRENCIES.filter((c) => Boolean(TOKEN_ADDRESSES[c]));
}

/**
 * Symbol for the token a vault actually holds.
 *
 * The listing's own currency label comes from creator-supplied metadata, so it
 * is a claim rather than a fact. Anywhere we state a sum of money that is about
 * to move — a milestone release, a refund — the label should come from the
 * vault's `token` address instead, which no one can restate after the fact.
 *
 * Returns undefined for a token this deployment has no name for, so the caller
 * can show the raw address rather than assert a wrong one.
 */
export function currencyForToken(address: string | undefined): Currency | undefined {
  if (!address) return undefined;
  return CURRENCIES.find((c) => TOKEN_ADDRESSES[c] === address);
}

export function toStroops(amount: number | string): bigint {
  const [whole, fraction = ""] = String(amount).split(".");
  const padded = (fraction + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS_PER_UNIT + BigInt(padded || "0");
}

export function fromStroops(stroops: bigint | string | number): number {
  return Number(BigInt(stroops)) / Number(STROOPS_PER_UNIT);
}
