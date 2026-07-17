
"use client";

import React from "react";
import type { Currency } from "./types";
import { CurrencyIcon } from "@/components/layout/CurrencyIcon";

export function formatCurrency(amount: number, currency: Currency = 'XLM', showIcon = true) {
  if (isNaN(amount)) {
    return "0.00";
  }

  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  if (showIcon) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        {formattedAmount} <CurrencyIcon currency={currency} className="h-4 w-4" />
      </span>
    );
  }

  return `${formattedAmount} ${currency}`;
}

    