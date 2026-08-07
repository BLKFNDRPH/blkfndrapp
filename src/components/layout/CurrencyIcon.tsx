import { UsdcLogo } from "./UsdcLogo";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";

interface CurrencyIconProps extends React.SVGProps<SVGSVGElement> {
  /**
   * Deliberately wider than `Currency`. The database enum is a superset of the
   * currencies the app offers — it still accepts USDT, WBTC and WETH, which no
   * longer have a token address — so a stored row can carry a value this
   * component has no logo for. Rendering the generic coin is the right answer
   * there; refusing to compile is not.
   */
  currency: string | undefined;
}

export function CurrencyIcon({
  currency,
  className,
  ...props
}: CurrencyIconProps) {
  if (currency === "USDC") {
    return <UsdcLogo className={cn("h-4 w-4", className)} {...props} />;
  }
  return (
    <Coins
      className={cn("h-4 w-4 text-orange-500", className)}
      {...(props as any)}
    />
  );
}
