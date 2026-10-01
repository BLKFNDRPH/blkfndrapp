import { Horizon, xdr } from "@stellar/stellar-sdk";
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
  /** Horizon operation type, e.g. "invoke_host_function". */
  type: string;
  /** What the operation did, in words: "Fund vault", "Open milestone vote", "Payment". */
  label: string;
  /** The contract function it called, for contract calls. */
  contract_function?: string;
  created_at: string;
  transaction_hash: string;
  successful: boolean;
  /**
   * Net movement for this account, one entry per asset: negative when it
   * left the account, positive when it arrived. Empty when nothing moved
   * (a vote, a trustline).
   */
  changes: { asset: string; amount: string }[];
}

const STROOPS_PER_UNIT = BigInt(10_000_000);

const toStroops = (amount: string): bigint => {
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * STROOPS_PER_UNIT +
    BigInt(fraction.padEnd(7, "0").slice(0, 7))
  );
};

const fromStroops = (stroops: bigint): string => {
  const sign = stroops < 0 ? "-" : "+";
  const abs = stroops < 0 ? -stroops : stroops;
  const fraction = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${sign}${abs / STROOPS_PER_UNIT}.${fraction}`;
};

const assetName = (assetType?: string, assetCode?: string) =>
  assetType === "native" ? "XLM" : assetCode || "Unknown";

const humanize = (name: string) => {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Contract functions whose own name doesn't say what the user did.
const CONTRACT_FUNCTION_LABELS: Record<string, string> = {
  contribute: "Fund vault",
  transfer: "Token transfer",
};

/**
 * The function an invoke-contract operation called. Horizon lists its
 * parameters as [contract address, function symbol, ...arguments].
 */
const contractFunctionName = (operation: any): string | undefined => {
  if (!String(operation.function ?? "").includes("InvokeContract")) {
    return undefined;
  }
  const symbol = operation.parameters?.[1];
  if (symbol?.type !== "Sym") return undefined;
  try {
    return xdr.ScVal.fromXDR(symbol.value, "base64").sym().toString();
  } catch {
    return undefined;
  }
};

const operationLabel = (operation: any, contractFunction?: string): string => {
  if (contractFunction) {
    return CONTRACT_FUNCTION_LABELS[contractFunction] ?? humanize(contractFunction);
  }
  const hostFunction = String(operation.function ?? "");
  switch (operation.type) {
    case "invoke_host_function":
      if (hostFunction.includes("UploadContractWasm")) return "Upload contract code";
      if (hostFunction.includes("CreateContract")) return "Deploy contract";
      return "Contract call";
    case "change_trust": {
      const asset = operation.asset_code ? `${operation.asset_code} ` : "";
      return operation.limit === "0.0000000"
        ? `Remove ${asset}trustline`
        : `Add ${asset}trustline`;
    }
    case "path_payment_strict_send":
    case "path_payment_strict_receive":
      return operation.from === operation.to ? "Swap" : "Path payment";
    default:
      return humanize(operation.type);
  }
};

/** What an operation moved into (+) or out of (−) `publicKey`, per asset. */
const netChanges = (operation: any, publicKey: string) => {
  const net = new Map<string, bigint>();
  const add = (asset: string, amount: string | undefined, sign: 1 | -1) => {
    if (!amount) return;
    const delta = toStroops(amount);
    net.set(asset, (net.get(asset) ?? BigInt(0)) + (sign === 1 ? delta : -delta));
  };

  switch (operation.type) {
    case "invoke_host_function":
      // Contract calls carry no amount of their own; Horizon reports the
      // token transfers they caused as asset_balance_changes.
      for (const change of operation.asset_balance_changes ?? []) {
        const asset = assetName(change.asset_type, change.asset_code);
        if (change.to === publicKey) add(asset, change.amount, 1);
        if (change.from === publicKey) add(asset, change.amount, -1);
      }
      break;
    case "payment": {
      const asset = assetName(operation.asset_type, operation.asset_code);
      if (operation.to === publicKey) add(asset, operation.amount, 1);
      if (operation.from === publicKey) add(asset, operation.amount, -1);
      break;
    }
    case "path_payment_strict_send":
    case "path_payment_strict_receive":
      if (operation.to === publicKey) {
        add(assetName(operation.asset_type, operation.asset_code), operation.amount, 1);
      }
      if (operation.from === publicKey) {
        add(
          assetName(operation.source_asset_type, operation.source_asset_code),
          operation.source_amount,
          -1,
        );
      }
      break;
    case "create_account":
      if (operation.account === publicKey) add("XLM", operation.starting_balance, 1);
      if (operation.funder === publicKey) add("XLM", operation.starting_balance, -1);
      break;
  }

  return [...net]
    .filter(([, stroops]) => stroops !== BigInt(0))
    .map(([asset, stroops]) => ({ asset, amount: fromStroops(stroops) }));
};

/**
 * The account's recent operations of every kind — contract calls (funding,
 * votes, refunds), payments, trustlines — failed ones included. Horizon's
 * /payments feed is not enough: it drops contract calls that moved no
 * tokens, and its records for the ones that did have no `amount` field.
 *
 * An account Horizon has never seen has no history, so a 404 is an empty
 * list; any other failure throws, so it isn't mistaken for "no activity".
 */
export const getRecentAccountOperations = async (
  publicKey: string,
  limit = 20,
): Promise<StellarAccountActivityItem[]> => {
  let response;
  try {
    response = await horizonClient
      .operations()
      .forAccount(publicKey)
      .includeFailed(true)
      .order("desc")
      .limit(limit)
      .call();
  } catch (error: any) {
    if (error.response?.status === 404) return [];
    throw error;
  }

  return response.records.map((record) => {
    const operation = record as any;
    const contractFunction = contractFunctionName(operation);
    const successful = operation.transaction_successful !== false;
    return {
      id: operation.id,
      type: operation.type,
      label: operationLabel(operation, contractFunction),
      contract_function: contractFunction,
      created_at: operation.created_at,
      transaction_hash: operation.transaction_hash,
      successful,
      // A failed transaction moved nothing, whatever its operation asked for.
      changes: successful ? netChanges(operation, publicKey) : [],
    };
  });
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
