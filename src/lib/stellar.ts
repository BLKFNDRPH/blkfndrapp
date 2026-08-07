import { Horizon } from "@stellar/stellar-sdk";
import {
  HORIZON_URL,
  SOROBAN_RPC_URL,
  NETWORK_PASSPHRASE,
  adminClient,
  simulate,
} from "@/lib/stellar-clients";

export { NETWORK_PASSPHRASE, SOROBAN_RPC_URL, HORIZON_URL };

export const horizonClient = new Horizon.Server(HORIZON_URL);

export const getAccountInfo = async (publicKey: string): Promise<any> => {
  try {
    return await horizonClient.loadAccount(publicKey);
  } catch (error: any) {
    if (error.response?.status === 404) {
      return {
        balances: [{ asset_type: "native", balance: "0.0000" }],
        sequence: null,
      };
    }
    console.error("Error fetching account info:", error);
    throw error;
  }
};

export const getBalance = async (publicKey: string) => {
  try {
    const account = await getAccountInfo(publicKey);
    return account.balances;
  } catch {
    return [{ asset_type: "native", balance: "0.0000" }];
  }
};

export interface StellarAccountActivityItem {
  id: string;
  type: string;
  created_at: string;
  transaction_hash?: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
}

export const getRecentAccountOperations = async (
  publicKey: string,
  limit = 20,
): Promise<StellarAccountActivityItem[]> => {
  try {
    const response = await horizonClient
      .operations()
      .forAccount(publicKey)
      .order("desc")
      .limit(limit)
      .call();

    return response.records.map((record) => {
      const operation = record as any;
      return {
        id: operation.id,
        type: operation.type,
        created_at: operation.created_at,
        transaction_hash: operation.transaction_hash,
        from: operation.from,
        to: operation.to,
        amount: operation.amount,
        asset_type: operation.asset_type,
        asset_code: operation.asset_code,
      };
    });
  } catch (error: any) {
    if (error.response?.status === 404) {
      return [];
    }
    console.error("Error fetching account operations:", error);
    return [];
  }
};

/**
 * Whether an address is a platform admin, according to the chain.
 *
 * Reads the admin roster, which is the single on-chain answer to that question.
 * It previously consulted the factory admin and the approval module's signer
 * list — two sources that could disagree, neither of which was the roster the
 * app actually meant.
 *
 * Note what being an admin does *not* confer: nothing in this roster can
 * release a milestone, block a refund, or move a vault's balance. It decides
 * who sees the admin console, and is mirrored into Supabase app_metadata so RLS
 * policies can act on it.
 *
 * Fails closed. An unreachable RPC means "not an admin", never "assume yes".
 */
export async function checkIsAdminOnChain(stellarPublicKey: string): Promise<boolean> {
  if (!stellarPublicKey) return false;

  const result = await simulate(
    () => adminClient().is_admin({ account: stellarPublicKey }),
    `is_admin(${stellarPublicKey})`,
  );

  return result === true;
}
