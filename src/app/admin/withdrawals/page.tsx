"use client";

import React from "react";
import { VaultOperationsPanel } from "@/components/admin/VaultOperationsPanel";

export default function AdminWithdrawalsPage() {
  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 max-w-6xl flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight font-headline text-accent">
            Withdrawals
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Manage milestone approvals and perform bond slashing.
          </p>
        </div>
      </div>

      <div className="max-w-6xl w-full">
        <VaultOperationsPanel />
      </div>
    </div>
  );
}


