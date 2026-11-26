// The fee sponsor's caps and kill switch, as the database enforces them
// (20261127110000_sponsor_usage.sql). The pure half is
// src/lib/sponsor/policy.test.ts.
//
// Run with `npm run test:db`. Nothing here touches a real database.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { as, replay, type Claims } from "./replay.ts";

const ALICE = "00000000-0000-4000-8000-000000000003";
const BOB = "00000000-0000-4000-8000-000000000004";
const alice: Claims = { sub: ALICE, email: "alice@example.test" };

const WALLET_A = "GALICEWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const WALLET_A2 = "GALICESECONDWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const WALLET_B = "GBOBWALLETBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const VAULT = "CVAULTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let db: PGlite;

before(async () => {
  db = await replay();
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@example.test', now()),
      ('${BOB}', 'bob@example.test', now());
  `);
});

after(async () => {
  await db?.close();
});

/** Runs `fn` as the service role, the way /api/sponsor reaches the database, then rolls back. */
async function asService(fn: (tx: Transaction) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    await fn(tx);
    await tx.rollback();
  });
}

type Claim = { slot_id: number | null; refusal: string | null };

async function claim(
  tx: Transaction,
  opts: { user?: string | null; account?: string; fee?: number; perAccount?: number; budget?: number } = {},
): Promise<Claim> {
  const res = await tx.query<Claim>(
    `select * from public.claim_sponsor_slot($1, $2, $3, 'contribute', $4, $5, $6)`,
    [
      opts.user === undefined ? ALICE : opts.user,
      opts.account ?? WALLET_A,
      VAULT,
      opts.fee ?? 100_000,
      opts.perAccount ?? 3,
      opts.budget ?? 10_000_000,
    ],
  );
  return res.rows[0];
}

describe("sponsor_usage is server-only", () => {
  for (const [who, role, claims] of [["anon", "anon", null], ["a signed-in user", "authenticated", alice]] as const) {
    test(`${who} cannot read or write it`, async () => {
      const read = await as(db, role, claims, `select id from public.sponsor_usage`);
      assert.equal(read.ok, false, "reading sponsor_usage should be refused");
      const write = await as(db, role, claims,
        `insert into public.sponsor_usage (account, contract_id, function_name, fee_stroops) values ('G', 'C', 'f', 1)`);
      assert.equal(write.ok, false, "writing sponsor_usage should be refused");
    });

    test(`${who} cannot claim or settle a slot`, async () => {
      const c = await as(db, role, claims,
        `select * from public.claim_sponsor_slot($1, 'G', 'C', 'f', 1, 1000, 1000000)`, [ALICE]);
      assert.equal(c.ok, false, "claiming a slot from the browser should be refused");
      const s = await as(db, role, claims, `select public.settle_sponsor_slot(1, 'rejected', null)`);
      assert.equal(s.ok, false, "settling a slot from the browser should be refused");
    });
  }
});

describe("claim_sponsor_slot enforces the caps", () => {
  test("the per-account count is a hard ceiling", async () => {
    await asService(async (tx) => {
      for (let i = 0; i < 3; i++) {
        const c = await claim(tx);
        assert.equal(c.refusal, null);
        assert.ok(c.slot_id);
      }
      assert.deepEqual(await claim(tx), { slot_id: null, refusal: "account_cap" });
      // Another account still has room.
      assert.equal((await claim(tx, { user: BOB, account: WALLET_B })).refusal, null);
    });
  });

  test("a second wallet on the same account shares the account's count", async () => {
    await asService(async (tx) => {
      for (let i = 0; i < 3; i++) await claim(tx);
      assert.equal((await claim(tx, { account: WALLET_A2 })).refusal, "account_cap");
    });
  });

  test("the wallet is counted even when the account changes", async () => {
    await asService(async (tx) => {
      for (let i = 0; i < 3; i++) await claim(tx);
      assert.equal((await claim(tx, { user: BOB, account: WALLET_A })).refusal, "account_cap");
    });
  });

  test("the daily budget may be met but not exceeded", async () => {
    await asService(async (tx) => {
      assert.equal((await claim(tx, { fee: 600, budget: 1_000 })).refusal, null);
      assert.equal((await claim(tx, { user: BOB, account: WALLET_B, fee: 401, budget: 1_000 })).refusal, "budget_exhausted");
      assert.equal((await claim(tx, { user: BOB, account: WALLET_B, fee: 400, budget: 1_000 })).refusal, null);
    });
  });

  test("a slot the network rejected stops counting; a submitted one keeps counting", async () => {
    await asService(async (tx) => {
      const first = await claim(tx, { perAccount: 1 });
      assert.equal((await claim(tx, { perAccount: 1 })).refusal, "account_cap");

      await tx.query(`select public.settle_sponsor_slot($1, 'rejected', 'abc')`, [first.slot_id]);
      const second = await claim(tx, { perAccount: 1 });
      assert.equal(second.refusal, null);

      await tx.query(`select public.settle_sponsor_slot($1, 'submitted', 'def')`, [second.slot_id]);
      assert.equal((await claim(tx, { perAccount: 1 })).refusal, "account_cap");

      // Settling is one-way: a submitted slot cannot be re-labelled rejected.
      await tx.query(`select public.settle_sponsor_slot($1, 'rejected', null)`, [second.slot_id]);
      const row = await tx.query<{ status: string; tx_hash: string }>(
        `select status, tx_hash from public.sponsor_usage where id = $1`, [second.slot_id]);
      assert.deepEqual(row.rows[0], { status: "submitted", tx_hash: "def" });
    });
  });

  test("yesterday's usage does not count today", async () => {
    await asService(async (tx) => {
      await tx.query(
        `insert into public.sponsor_usage (user_id, account, contract_id, function_name, fee_stroops, day, status)
         select $1, $2, $3, 'contribute', 1000, (now() at time zone 'utc')::date - 1, 'submitted'
           from generate_series(1, 5)`,
        [ALICE, WALLET_A, VAULT],
      );
      assert.equal((await claim(tx, { fee: 1_000, budget: 1_000 })).refusal, null);
    });
  });

  test("a non-positive fee is refused", async () => {
    await asService(async (tx) => {
      await assert.rejects(claim(tx, { fee: 0 }));
    });
  });
});

describe("the kill switch in platform_settings", () => {
  test("sponsor_paused defaults to false", async () => {
    const res = await db.query<{ sponsor_paused: boolean }>(
      `select sponsor_paused from public.platform_settings where id`);
    assert.deepEqual(res.rows, [{ sponsor_paused: false }]);
  });

  test("a signed-in user cannot flip it", async () => {
    const o = await as(db, "authenticated", alice, `update public.platform_settings set sponsor_paused = true`);
    if (o.ok) assert.equal(o.affected, 0);
  });
});
