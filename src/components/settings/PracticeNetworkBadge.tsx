import { Badge } from "@/components/ui/badge";
import { IS_PRACTICE_NETWORK } from "@/lib/network";

/**
 * "Testnet", or nothing at all on Mainnet.
 *
 * Its own module, apart from the wallet panel, so the header can show it
 * without loading the panel, which brings the whole Stellar SDK with it.
 */
export function PracticeNetworkBadge() {
  if (!IS_PRACTICE_NETWORK) return null;
  return (
    <Badge className="border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-300">
      Testnet
    </Badge>
  );
}
