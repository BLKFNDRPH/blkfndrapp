
"use client";

import React from "react";
import { CurrencyIcon } from "@/components/layout/CurrencyIcon";

// `currency` is a plain string rather than `Currency` because callers pass it
// straight from a database row, and the `currency_type` enum is a superset of
// the currencies the app still offers. Formatting a legacy value should print
// it, not fail.
export function formatCurrency(amount: number, currency: string = 'XLM', showIcon = true) {
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

    