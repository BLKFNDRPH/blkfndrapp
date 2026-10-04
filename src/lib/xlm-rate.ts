"use client";

import useSWR from "swr";

/**
 * The dollar price of XLM, for the "≈ $" figures next to XLM vault amounts.
 *
 * One fetch shared by every component on the page, refreshed every five
 * minutes, never on tab focus. There is deliberately no made-up fallback rate:
 * when the request fails the hook returns null and the money helpers show the
 * XLM figure on its own, which is honest, where a stale hard-coded number is
 * not.
 */

const RATE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";

export type XlmRate = {
  /** Dollars per XLM, or null while loading or when unavailable. */
  rate: number | null;
  /** When this rate was fetched, or null when there is none. */
  updatedAt: number | null;
  isLoading: boolean;
};

async function fetchRate(): Promise<{ rate: number; updatedAt: number }> {
  const res = await fetch(RATE_URL);
  if (!res.ok) throw new Error(`Rate request failed: ${res.status}`);
  const data = await res.json();
  const rate = Number(data?.stellar?.usd);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Rate missing");
  return { rate, updatedAt: Date.now() };
}

export function useXlmRate(): XlmRate {
  const { data, isLoading } = useSWR("xlm-usd-rate", fetchRate, {
    dedupingInterval: 5 * 60_000,
    refreshInterval: 5 * 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return {
    rate: data?.rate ?? null,
    updatedAt: data?.updatedAt ?? null,
    isLoading,
  };
}
