import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shorten a wallet address for display (EVM, Stellar G/C..., etc.). */
export function shortenAddress(
  address: string | undefined | null,
  head = 6,
  tail = 4,
) {
  if (!address) return "";
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
