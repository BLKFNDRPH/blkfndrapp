import "server-only";

import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  ADMIN_ID,
  ATTESTATION_ID,
  FACTORY_ID,
  IDENTITY_ID,
  NETWORK_PASSPHRASE,
  OPERATIONS_ID,
  SOROBAN_RPC_URL,
  factoryClient,
  simulate,
} from "@/lib/stellar-clients";

/**
 * Keeps the platform's shared contract storage alive.
 *
 * Soroban charges rent: every contract instance and every uploaded contract
 * code lives only until its TTL runs out, then it is archived and must be
 * restored -- and paid for again -- before anything can use it. Our contracts
 * extend their own entries by ~30 days whenever they are called, which works
 * for a busy contract and fails quietly for an idle one.
 *
 * The vault code is the case that bit. Uploaded on 9 Aug and then not used by
 * any vault, it expired, and from then on every launch had to restore 48 KB of
 * code and extend it for 30 days inside the builder's own transaction: ~60 of
 * the 84 XLM a launch cost when QA Trial #3 was re-simulated (172 XLM at the
 * time of the trial). Whoever launched first after a lapse paid to resurrect
 * code that every vault shares.
 *
 * So the platform keeps it alive instead. Daily, this reads the TTL of every
 * shared instance and code entry -- the factory, both registries, the admin
 * roster, the treasury, the Operations Vault, and the vault code the factory
 * deploys -- restores anything archived and tops up anything with less than 21
 * days left to 60. Both operations are permissionless; the key only pays the
 * fee, as with settle-stalled and ops-funding.
 *
 * Project vault instances are not on the list. Each one is extended by its own
 * calls, and its rent is its project's, not the platform's.
 */

const LEDGERS_PER_DAY = 17_280; // 5-second ledgers
/** Anything with less than this left is topped up. */
const THRESHOLD_LEDGERS = 21 * LEDGERS_PER_DAY;
/** ...to this. */
const TARGET_LEDGERS = 60 * LEDGERS_PER_DAY;
/**
 * Per-transaction read budget. Extending reads every entry it touches, and
 * the network caps disk reads per transaction, so large code entries are
 * batched apart.
 */
const MAX_BATCH_BYTES = 64 * 1024;

type EntryState = "live" | "due" | "archived";

export interface KeptEntry {
  label: string;
  state: EntryState;
  /** Days of TTL left, or null when archived. */
  daysLeft: number | null;
  bytes: number;
}

export interface KeepAliveResult {
  status: "done" | "skipped" | "dry-run";
  detail: string;
  entries: KeptEntry[];
  restored: number;
  extended: number;
  /** Fees charged -- or, in a dry run, the simulated cost -- in XLM. */
  feeXlm: number;
}

interface Tracked {
  label: string;
  key: xdr.LedgerKey;
  bytes: number;
  liveUntil: number;
}

function instanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

function codeKey(hash: Buffer): xdr.LedgerKey {
  return xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash }));
}

/** The factory stores the code hash it deploys vaults from; it has no getter. */
function vaultWasmHashFromFactory(instance: xdr.ScContractInstance): Buffer | null {
  for (const entry of instance.storage() ?? []) {
    const k = entry.key();
    if (
      k.switch().name === "scvVec" &&
      k.vec()?.length === 1 &&
      k.vec()![0].switch().name === "scvSymbol" &&
      k.vec()![0].sym().toString() === "VaultWasmHash" &&
      entry.val().switch().name === "scvBytes"
    ) {
      return entry.val().bytes();
    }
  }
  return null;
}

/** Every shared contract the platform depends on, by name. */
async function sharedContracts(): Promise<Array<[string, string]>> {
  const named: Array<[string, string | undefined]> = [
    ["factory", FACTORY_ID],
    ["identity registry", IDENTITY_ID],
    ["attestation registry", ATTESTATION_ID],
    ["admin roster", ADMIN_ID],
    ["operations vault", OPERATIONS_ID],
  ];
  // Read rather than configured, like everywhere else the treasury is named:
  // the factory's fee wallet is the one that matters.
  const treasury = FACTORY_ID
    ? await simulate(() => factoryClient().get_fee_wallet(), "get_fee_wallet")
    : null;
  if (treasury) named.push(["treasury", String(treasury)]);
  return named.filter((n): n is [string, string] => Boolean(n[1]));
}

/** Read the instances, follow them to their code, and record every TTL. */
async function collect(server: rpc.Server): Promise<Tracked[]> {
  const contracts = await sharedContracts();
  const instances = await server.getLedgerEntries(...contracts.map(([, id]) => instanceKey(id)));
  const byKey = new Map(instances.entries.map((e) => [e.key.toXDR("base64"), e]));

  const tracked: Tracked[] = [];
  const codes = new Map<string, string>(); // hash hex -> label

  for (const [name, id] of contracts) {
    const key = instanceKey(id);
    const entry = byKey.get(key.toXDR("base64"));
    if (!entry) {
      console.warn(`[keep-alive] no instance found for ${name} ${id}`);
      continue;
    }
    tracked.push({
      label: `${name} instance`,
      key,
      bytes: entry.val.toXDR().length,
      liveUntil: entry.liveUntilLedgerSeq ?? 0,
    });

    const instance = entry.val.contractData().val().instance();
    const executable = instance.executable();
    if (executable.switch().name === "contractExecutableWasm") {
      const hex = executable.wasmHash().toString("hex");
      if (!codes.has(hex)) codes.set(hex, `${name} code`);
    }
    if (id === FACTORY_ID) {
      const vaultHash = vaultWasmHashFromFactory(instance);
      if (vaultHash) codes.set(vaultHash.toString("hex"), "vault code");
    }
  }

  const codeKeys = [...codes.keys()].map((hex) => codeKey(Buffer.from(hex, "hex")));
  if (codeKeys.length > 0) {
    const codeEntries = await server.getLedgerEntries(...codeKeys);
    const codeByKey = new Map(codeEntries.entries.map((e) => [e.key.toXDR("base64"), e]));
    for (const key of codeKeys) {
      const entry = codeByKey.get(key.toXDR("base64"));
      const hex = key.contractCode().hash().toString("hex");
      if (!entry) {
        console.warn(`[keep-alive] code ${hex.slice(0, 8)}… not found`);
        continue;
      }
      tracked.push({
        label: `${codes.get(hex)} ${hex.slice(0, 8)}…`,
        key,
        bytes: entry.val.toXDR().length,
        liveUntil: entry.liveUntilLedgerSeq ?? 0,
      });
    }
  }
  return tracked;
}

function stateOf(t: Tracked, latest: number): EntryState {
  // An archived entry is reported with no live-until ledger (0) or one in the
  // past.
  if (!t.liveUntil || t.liveUntil < latest) return "archived";
  return t.liveUntil - latest < THRESHOLD_LEDGERS ? "due" : "live";
}

/** Group keys so no transaction reads more than MAX_BATCH_BYTES. */
function batches(items: Tracked[]): Tracked[][] {
  const out: Tracked[][] = [];
  let current: Tracked[] = [];
  let size = 0;
  for (const item of [...items].sort((a, b) => b.bytes - a.bytes)) {
    if (current.length > 0 && size + item.bytes > MAX_BATCH_BYTES) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.bytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function buildTx(
  account: Awaited<ReturnType<rpc.Server["getAccount"]>>,
  op: "restore" | "extend",
  keys: xdr.LedgerKey[],
) {
  const data =
    op === "restore"
      ? new SorobanDataBuilder().setReadWrite(keys).build()
      : new SorobanDataBuilder().setReadOnly(keys).build();
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(
      op === "restore"
        ? Operation.restoreFootprint({})
        : Operation.extendFootprintTtl({ extendTo: TARGET_LEDGERS }),
    )
    .setSorobanData(data)
    .setTimeout(60)
    .build();
}

/**
 * Simulate, sign, send and wait. Returns the fee actually charged, in stroops
 * -- less than the fee bid, since Soroban refunds what the transaction did not
 * use.
 */
async function submit(
  server: rpc.Server,
  keypair: Keypair,
  op: "restore" | "extend",
  keys: xdr.LedgerKey[],
): Promise<number> {
  const account = await server.getAccount(keypair.publicKey());
  const prepared = await server.prepareTransaction(buildTx(account, op, keys));
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`${op} was rejected: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${op} ${sent.hash} ended ${final.status}`);
  }
  const charged = Number(final.resultXdr.feeCharged().toString());
  return Number.isFinite(charged) ? charged : Number(prepared.fee);
}

/** The simulated cost of one batch, in stroops, without sending anything. */
async function estimate(
  server: rpc.Server,
  source: string,
  op: "restore" | "extend",
  keys: xdr.LedgerKey[],
): Promise<number> {
  const account = await server.getAccount(source);
  const sim = await server.simulateTransaction(buildTx(account, op, keys));
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${op} simulation failed: ${sim.error}`);
  return Number(sim.minResourceFee);
}

/**
 * One keep-alive pass.
 *
 * `dryRun` reads and simulates only: it reports what is due and roughly what
 * it would cost, and sends nothing. It still needs an existing account to
 * simulate from -- the submitter's, or `sourcePublicKey`.
 */
export async function runKeepAlive(
  options: { dryRun?: boolean; sourcePublicKey?: string } = {},
): Promise<KeepAliveResult> {
  const submitterSecret = process.env.OPS_FUNDING_SUBMITTER_SECRET;
  const keypair = submitterSecret ? Keypair.fromSecret(submitterSecret) : null;
  const source = options.sourcePublicKey ?? keypair?.publicKey();

  if (!FACTORY_ID) {
    return { status: "skipped", detail: "NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID is not set.", entries: [], restored: 0, extended: 0, feeXlm: 0 };
  }
  if (!options.dryRun && !keypair) {
    return { status: "skipped", detail: "OPS_FUNDING_SUBMITTER_SECRET is not set.", entries: [], restored: 0, extended: 0, feeXlm: 0 };
  }

  const server = new rpc.Server(SOROBAN_RPC_URL);
  const latest = (await server.getLatestLedger()).sequence;
  const tracked = await collect(server);

  const entries: KeptEntry[] = tracked.map((t) => {
    const state = stateOf(t, latest);
    return {
      label: t.label,
      state,
      daysLeft: state === "archived" ? null : Math.round(((t.liveUntil - latest) / LEDGERS_PER_DAY) * 10) / 10,
      bytes: t.bytes,
    };
  });

  const archived = tracked.filter((t) => stateOf(t, latest) === "archived");
  const due = tracked.filter((t) => stateOf(t, latest) !== "live");

  if (due.length === 0) {
    return { status: options.dryRun ? "dry-run" : "skipped", detail: `All ${tracked.length} shared entries have at least 21 days left.`, entries, restored: 0, extended: 0, feeXlm: 0 };
  }

  if (options.dryRun) {
    if (!source) {
      return { status: "dry-run", detail: `${due.length} of ${tracked.length} entries are due (${archived.length} archived). No source account to estimate the cost from.`, entries, restored: 0, extended: 0, feeXlm: 0 };
    }
    let stroops = 0;
    for (const batch of batches(archived)) stroops += await estimate(server, source, "restore", batch.map((t) => t.key));
    // Restored entries come back with a minimal TTL, so they are extended too.
    // Extending one that is still archived cannot be simulated, so the
    // estimate covers the entries that are merely due.
    for (const batch of batches(due.filter((t) => stateOf(t, latest) === "due"))) {
      stroops += await estimate(server, source, "extend", batch.map((t) => t.key));
    }
    return {
      status: "dry-run",
      detail: `${due.length} of ${tracked.length} entries are due (${archived.length} archived). Estimate excludes extending the restored entries.`,
      entries,
      restored: 0,
      extended: 0,
      feeXlm: stroops / 10_000_000,
    };
  }

  let stroops = 0;
  for (const batch of batches(archived)) {
    stroops += await submit(server, keypair!, "restore", batch.map((t) => t.key));
  }
  for (const batch of batches(due)) {
    stroops += await submit(server, keypair!, "extend", batch.map((t) => t.key));
  }

  return {
    status: "done",
    detail: `Restored ${archived.length} and extended ${due.length} of ${tracked.length} shared entries to ${TARGET_LEDGERS / LEDGERS_PER_DAY} days.`,
    entries,
    restored: archived.length,
    extended: due.length,
    feeXlm: stroops / 10_000_000,
  };
}
