import { Client } from "@/packages/blkfndr_v2/src";
import { Networks } from "@stellar/stellar-sdk";
import { CONTRACT_ID, SOROBAN_RPC_URL } from "./stellar";

export const blkfndrClient = (publicKey: string, signer: any) => {
  return new Client({
    contractId: CONTRACT_ID!,
    rpcUrl: SOROBAN_RPC_URL!,
    networkPassphrase: Networks.TESTNET,
    publicKey,
    ...signer,
  });
};
