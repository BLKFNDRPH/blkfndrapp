import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  SPONSOR_DEFAULTS,
  SponsorRefusalError,
  capRefusal,
  checkInnerTransaction,
  isContractAllowed,
  planFeeBump,
  readSponsorConfig,
  sponsorIsOn,
  utcDay,
  type SponsorRefusal,
} from "./policy.ts";

/**
 * The fee sponsor's pure rules: what it will wrap, what a wrap bids, the caps
 * and the kill switch. The database half of the caps is in
 * supabase/tests/sponsor-usage.test.ts. Run with `npm test`.
 */

const NET = Networks.TESTNET;
const user = Keypair.random();
const stranger = Keypair.random();
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 7));
const FACTORY = StrKey.encodeContract(Buffer.alloc(32, 9));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 3));
const RESOURCE_FEE = 80_000;

function build(
  ops: xdr.Operation[],
  opts: { source?: Keypair; fee?: number; resourceFee?: number | null } = {},
) {
  const source = opts.source ?? user;
  const builder = new TransactionBuilder(new Account(source.publicKey(), "41"), {
    // The inclusion fee per operation; build() adds the resource fee itself.
    fee: String(opts.fee ?? 100),
    networkPassphrase: NET,
  });
  for (const op of ops) builder.addOperation(op);
  if (opts.resourceFee !== null) {
    builder.setSorobanData(
      new SorobanDataBuilder().setResourceFee(opts.resourceFee ?? RESOURCE_FEE).build(),
    );
  }
  return builder.setTimeout(300).build();
}

const call = (contract = VAULT, fn = "contribute") =>
  Operation.invokeContractFunction({ contract, function: fn, args: [] });

function signed(ops: xdr.Operation[], opts: Parameters<typeof build>[1] & { signer?: Keypair } = {}) {
  const tx = build(ops, opts);
  tx.sign(opts.signer ?? opts.source ?? user);
  return tx;
}

function refusal(fn: () => unknown): SponsorRefusal {
  try {
    fn();
  } catch (err) {
    if (err instanceof SponsorRefusalError) return err.code;
    throw err;
  }
  assert.fail("expected a refusal");
}

const check = (xdrText: string, expectedSource = user.publicKey()) =>
  checkInnerTransaction({ xdr: xdrText, networkPassphrase: NET, expectedSource });

describe("the inner transaction", () => {
  test("a single signed contract call from the linked wallet passes", () => {
    const out = check(signed([call()]).toXDR());
    assert.equal(out.source, user.publicKey());
    assert.equal(out.contractId, VAULT);
    assert.equal(out.functionName, "contribute");
  });

  test("a transaction from another wallet is refused", () => {
    const tx = signed([call()], { source: stranger });
    assert.equal(refusal(() => check(tx.toXDR())), "wrong_source");
  });

  test("an unsigned transaction is refused", () => {
    assert.equal(refusal(() => check(build([call()]).toXDR())), "wrong_network_or_unsigned");
  });

  test("a transaction signed by someone else is refused", () => {
    const tx = signed([call()], { signer: stranger });
    assert.equal(refusal(() => check(tx.toXDR())), "wrong_network_or_unsigned");
  });

  test("a transaction signed for another network is refused", () => {
    const tx = new TransactionBuilder(new Account(user.publicKey(), "41"), {
      fee: "100",
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(call())
      .setSorobanData(new SorobanDataBuilder().setResourceFee(RESOURCE_FEE).build())
      .setTimeout(300)
      .build();
    tx.sign(user);
    assert.equal(refusal(() => check(tx.toXDR())), "wrong_network_or_unsigned");
  });

  test("garbage and fee-bumps are refused", () => {
    assert.equal(refusal(() => check("not xdr")), "bad_xdr");
    const bump = TransactionBuilder.buildFeeBumpTransaction(stranger, "200", signed([call()]), NET);
    bump.sign(stranger);
    assert.equal(refusal(() => check(bump.toXDR())), "bad_xdr");
  });

  const notACall: Array<[string, xdr.Operation]> = [
    ["a payment", Operation.payment({ destination: stranger.publicKey(), asset: Asset.native(), amount: "1" })],
    ["an account merge", Operation.accountMerge({ destination: stranger.publicKey() })],
    ["set_options", Operation.setOptions({ masterWeight: 0 })],
    ["a trustline change", Operation.changeTrust({ asset: new Asset("USDC", stranger.publicKey()) })],
    ["a wasm upload", Operation.uploadContractWasm({ wasm: Buffer.from([0, 97, 115, 109]) })],
  ];
  for (const [what, op] of notACall) {
    test(`${what} is refused`, () => {
      assert.equal(refusal(() => check(signed([op], { resourceFee: null }).toXDR())), "not_single_contract_call");
    });
  }

  test("two operations are refused, even two contract calls", () => {
    const tx = signed([call(), call(VAULT, "approve_milestone")], { resourceFee: null });
    assert.equal(refusal(() => check(tx.toXDR())), "not_single_contract_call");
  });

  test("a call riding with a payment is refused", () => {
    const pay = Operation.payment({ destination: stranger.publicKey(), asset: Asset.native(), amount: "5" });
    assert.equal(refusal(() => check(signed([call(), pay], { resourceFee: null }).toXDR())), "not_single_contract_call");
  });

  test("a call with someone else as the operation source is refused", () => {
    const op = Operation.invokeContractFunction({
      contract: VAULT,
      function: "contribute",
      args: [],
      source: stranger.publicKey(),
    });
    assert.equal(refusal(() => check(signed([op]).toXDR())), "not_single_contract_call");
  });
});

describe("the allowlist", () => {
  const configured = [FACTORY, undefined, ""];

  test("configured contracts and indexed vaults are allowed", () => {
    assert.equal(isContractAllowed(FACTORY, configured, false), true);
    assert.equal(isContractAllowed(VAULT, configured, true), true);
  });

  test("anything else is not", () => {
    assert.equal(isContractAllowed(OTHER, configured, false), false);
    assert.equal(isContractAllowed("", configured, false), false);
  });

  test("an account address is never a contract", () => {
    assert.equal(isContractAllowed(user.publicKey(), [user.publicKey()], true), false);
  });
});

describe("the fee a bump bids", () => {
  test("matches buildFeeBumpTransaction and leaves the inner transaction alone", () => {
    const inner = signed([call()]);
    const plan = planFeeBump(inner, SPONSOR_DEFAULTS.maxFeeStroops);
    assert.equal(plan.baseFee, 100n);
    assert.equal(plan.totalFee, 200n + BigInt(RESOURCE_FEE));

    const ops = Keypair.random();
    const bump = TransactionBuilder.buildFeeBumpTransaction(ops, plan.baseFee.toString(), inner, NET);
    assert.equal(BigInt(bump.fee), plan.totalFee);
    assert.deepEqual(bump.innerTransaction.hash(), inner.hash());
    assert.equal(bump.innerTransaction.signatures.length, 1);
  });

  test("a higher inner inclusion fee is matched, rounded up", () => {
    const inner = signed([call()], { fee: 1_000 });
    const plan = planFeeBump(inner, SPONSOR_DEFAULTS.maxFeeStroops);
    assert.equal(plan.baseFee, 1_000n);
    assert.equal(plan.totalFee, 2_000n + BigInt(RESOURCE_FEE));
    TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), plan.baseFee.toString(), inner, NET);
  });

  test("a bid above the per-transaction maximum is refused", () => {
    const inner = signed([call()], { resourceFee: 2_000_000 });
    assert.equal(refusal(() => planFeeBump(inner, SPONSOR_DEFAULTS.maxFeeStroops)), "fee_too_high");
  });

  test("an inflated inclusion fee is caught by the same maximum", () => {
    const inner = signed([call()], { fee: 5_000_000 });
    assert.equal(refusal(() => planFeeBump(inner, SPONSOR_DEFAULTS.maxFeeStroops)), "fee_too_high");
  });

  test("an unsimulated call is refused", () => {
    const inner = signed([call()], { resourceFee: null });
    assert.equal(refusal(() => planFeeBump(inner, SPONSOR_DEFAULTS.maxFeeStroops)), "not_single_contract_call");
  });
});

describe("the caps", () => {
  const config = { perAccountDaily: 3, dailyBudgetStroops: 1_000n };

  test("room under both caps passes", () => {
    assert.equal(capRefusal({ accountCountToday: 2, spentTodayStroops: 500n, fee: 500n, config }), null);
  });

  test("the per-account count is a hard ceiling", () => {
    assert.equal(capRefusal({ accountCountToday: 3, spentTodayStroops: 0n, fee: 1n, config }), "account_cap");
  });

  test("the budget may be met but not exceeded", () => {
    assert.equal(capRefusal({ accountCountToday: 0, spentTodayStroops: 999n, fee: 1n, config }), null);
    assert.equal(capRefusal({ accountCountToday: 0, spentTodayStroops: 999n, fee: 2n, config }), "budget_exhausted");
  });

  test("days are UTC", () => {
    assert.equal(utcDay(new Date("2026-11-27T23:59:59-05:00")), "2026-11-28");
  });
});

describe("configuration and the kill switch", () => {
  test("unset means off, with the D3 placeholder caps", () => {
    const c = readSponsorConfig({});
    assert.equal(c.enabled, false);
    assert.equal(c.perAccountDaily, SPONSOR_DEFAULTS.perAccountDaily);
    assert.equal(c.dailyBudgetStroops, SPONSOR_DEFAULTS.dailyBudgetStroops);
    assert.equal(c.maxFeeStroops, SPONSOR_DEFAULTS.maxFeeStroops);
  });

  test("only an explicit yes turns it on", () => {
    for (const v of ["true", "TRUE", "1"]) assert.equal(readSponsorConfig({ SPONSOR_ENABLED: v }).enabled, true);
    for (const v of ["", "false", "0", "yes please", "on"]) {
      assert.equal(readSponsorConfig({ SPONSOR_ENABLED: v }).enabled, false, v);
    }
  });

  test("a malformed cap falls back to its default, never to no cap", () => {
    const c = readSponsorConfig({
      SPONSOR_PER_ACCOUNT_DAILY: "-5",
      SPONSOR_DAILY_BUDGET_STROOPS: "lots",
      SPONSOR_MAX_FEE_STROOPS: "0",
    });
    assert.equal(c.perAccountDaily, SPONSOR_DEFAULTS.perAccountDaily);
    assert.equal(c.dailyBudgetStroops, SPONSOR_DEFAULTS.dailyBudgetStroops);
    assert.equal(c.maxFeeStroops, SPONSOR_DEFAULTS.maxFeeStroops);
    assert.equal(readSponsorConfig({ SPONSOR_PER_ACCOUNT_DAILY: "5" }).perAccountDaily, 5);
  });

  test("both halves must say yes, and an unread pause flag counts as paused", () => {
    const on = { envEnabled: true, pausedInDatabase: false, opsKeyConfigured: true };
    assert.equal(sponsorIsOn(on), true);
    assert.equal(sponsorIsOn({ ...on, envEnabled: false }), false);
    assert.equal(sponsorIsOn({ ...on, pausedInDatabase: true }), false);
    assert.equal(sponsorIsOn({ ...on, pausedInDatabase: null }), false);
    assert.equal(sponsorIsOn({ ...on, opsKeyConfigured: false }), false);
  });
});
