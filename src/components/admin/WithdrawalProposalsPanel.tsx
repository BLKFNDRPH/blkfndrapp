"use client";

import React, { useEffect, useState } from "react";
import { BanknoteArrowDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "./../ui/card";
import { useStellarContract } from "@/hooks/use-stellar-contract";

export function WithdrawalProposalsPanel() {
  const [count, setCount] = useState<number | null>(null);
  const { getPendingProposals } = useStellarContract();

  useEffect(() => {
    let mounted = true;
    const load = () => {
      getPendingProposals()
        .then((proposals) => {
          if (mounted) setCount(proposals.length);
        })
        .catch(() => { if (mounted) setCount(0); });
    };
    load();
    const interval = setInterval(load, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, [getPendingProposals]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Pending Withdrawals</CardTitle>
        <div className="text-muted-foreground h-4 w-4">
          <BanknoteArrowDown />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{count === null ? '—' : count}</div>
      </CardContent>
    </Card>
  );
}