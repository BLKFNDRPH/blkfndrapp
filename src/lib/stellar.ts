import { Horizon, Networks } from "@stellar/stellar-sdk";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as ApprovalClient } from "@/packages/blkfndr_approval/src";


// Constants for Stellar network and contract mwehehhee
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = process.env.NEXT_PUBLIC_BLKFNDR_CONTRACT_ID;

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
  } catch (error) {
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

export { NETWORK_PASSPHRASE, CONTRACT_ID, SOROBAN_RPC_URL, HORIZON_URL };

export async function checkIsAdminOnChain(stellarPublicKey: string): Promise<boolean> {
  if (!stellarPublicKey) return false;
  try {
    const factoryContractId = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID;
    const approvalContractId = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID;
    
    if (!factoryContractId || !approvalContractId) {
      console.warn("[checkIsAdminOnChain] Factory or Approval contract ID is missing");
      return false;
    }

    const factoryClient = new FactoryClient({
      contractId: factoryContractId,
      rpcUrl: SOROBAN_RPC_URL!,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    const adminTx = await factoryClient.get_admin();
    const adminSim = await adminTx.simulate();
    const contractAdmin = adminSim.result;

    if (contractAdmin === stellarPublicKey) {
      return true;
    }

    const approvalClient = new ApprovalClient({
      contractId: approvalContractId,
      rpcUrl: SOROBAN_RPC_URL!,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    const signersTx = await approvalClient.get_signers();
    const signersSim = await signersTx.simulate();
    const multiSigAdmins: string[] = signersSim.result || [];

    return multiSigAdmins.includes(stellarPublicKey);
  } catch (err) {
    console.warn("[checkIsAdminOnChain] Failed to query admin status from contracts:", err);
  }
  return false;
}

