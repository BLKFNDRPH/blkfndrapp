"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { STROOPS_PER_UNIT, tokenAddressFor } from "@/lib/currencies";
import { readWalletReadiness, type WalletReadiness } from "@/lib/wallet-readiness";
import {
  WalletReadinessCard,
  readinessState,
} from "@/components/project/stake/WalletReadinessCard";

/** Base units of USDC as a person reads them: "$12.50". */
function dollars(raw: bigint): string {
  const whole = raw / STROOPS_PER_UNIT;
  const cents = (raw % STROOPS_PER_UNIT) / 100_000n;
  return `$${whole.toLocaleString()}.${cents.toString().padStart(2, "0")}`;
}

/**
 * The guide's live check on the linked wallet: is it active on Testnet, and
 * does it have the USDC trustline? The same card and the same two fixes the
 * stake sheet uses (Friendbot, and a trustline signed in the person's own
 * wallet), pointed at the USDC the vaults hold.
 */
export function CampaignWalletCheck() {
  const { user } = useAuth();
  const address = user?.stellarPublicKey || "";
  const [readiness, setReadiness] = useState<WalletReadiness | null>(null);
  const [loading, setLoading] = useState(false);

  let token: string | null = null;
  try {
    token = tokenAddressFor("USDC");
  } catch {
    token = null;
  }

  const refresh = useCallback(async () => {
    if (!address || !token) return;
    setLoading(true);
    try {
      setReadiness(await readWalletReadiness(address, token));
    } finally {
      setLoading(false);
    }
  }, [address, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!user) {
    return <p className="text-sm text-muted-foreground">Sign in and link your wallet (step 6) to check it here.</p>;
  }
  if (!address) {
    return <p className="text-sm text-muted-foreground">Link your wallet (step 6), then come back here to check it.</p>;
  }
  if (!token) {
    return <p className="text-sm text-muted-foreground">USDC isn&apos;t configured on this site yet.</p>;
  }

  return (
    <WalletReadinessCard
      address={address}
      readiness={readiness}
      state={readinessState(readiness, loading, null)}
      needRaw={null}
      isDollar
      display={dollars}
      onRefresh={() => void refresh()}
    />
  );
}
