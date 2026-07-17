import type { Currency } from "@/lib/types";
import { UsdcLogo } from "./UsdcLogo";
import { UsdtLogo } from "./UsdtLogo";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";

interface CurrencyIconProps extends React.SVGProps<SVGSVGElement> {
  currency: Currency;
}

export function CurrencyIcon({
  currency,
  className,
  ...props
}: CurrencyIconProps) {
  switch (currency) {
    case "USDC":
      return <UsdcLogo className={cn("h-4 w-4", className)} {...props} />;
    case "USDT":
      return <UsdtLogo className={cn("h-4 w-4", className)} {...props} />;
    case "XLM":
    case "WBTC":
    case "WETH":
      return (
        <Coins
          className={cn("h-4 w-4 text-orange-500", className)}
          {...(props as any)}
        />
      );
    default:
      return null;
  }
}
