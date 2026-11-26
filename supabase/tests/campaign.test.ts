// The campaign tables (20261127100000_campaign_referrals.sql): server-only,
// self-referral and double attribution refused, and the practice-USDC claim
// admitted once per account, once per wallet and under the daily cap.
//
// Run with `npm run test:db`. Nothing here touches a real database.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { as, replay, type Claims } from "./replay.ts";

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b0";
const CAROL = "00000000-0000-4000-8000-0000000000c0";
const DAVE = "00000000-0000-4000-8000-0000000000d0";
const alice: Claims = { sub: ALICE, email: "alice@example.test" };

const W1 = "G" + "A".repeat(55);
const W2 = "G" + "B".repeat(55);
const W3 = "G" + "C".repeat(55);
const ISSUER = "G" + "D".repeat(55);

let db: PGlite;

before(async () => {
  db = await replay();
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ALICE}', 'alice@example.test', now()),
      ('${BOB}', 'bob@example.test', now()),
      ('${CAROL}', 'carol@example.test', now()),
      ('${DAVE}', 'dave@example.test', now());
    insert into public.referral_codes (user_id, code) values ('${ALICE}', 'ABCD2345');
  `);
});

after(async () => {
  await db?.close();
});

/** Runs as the service role, the way src/lib/campaign does, inside a rolled-back transaction. */
async function asService<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<T[]>) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    await fn(async (sql, params = []) => (await tx.query<T>(sql, params)).rows);
    await tx.rollback();
  });
}

const reserve = (user: string, wallet: string, cap = 50) =>
  `select * from public.campaign_reserve_usdc_claim('${user}', '${wallet}', 1000000000, 'USDC', '${ISSUER}', ${cap})`;

describe("campaign tables are server-only", () => {
  for (const table of ["referral_codes", "campaign_referrals", "campaign_usdc_claims"]) {
    test(`a browser session cannot read ${table}`, async () => {
      const o = await as(db, "authenticated", alice, `select * from public.${table}`);
      assert.equal(o.ok, false, `reading ${table} should be refused`);
    });

    test(`a browser session cannot write ${table}`, async () => {
      const o = await as(db, "authenticated", alice, `delete from public.${table}`);
      assert.equal(o.ok, false, `deleting from ${table} should be refused`);
    });
  }

  test("a browser session cannot reserve a claim", async () => {
    const o = await as(db, "authenticated", alice, reserve(ALICE, W1));
    assert.equal(o.ok, false);
    const anon = await as(db, "anon", null, reserve(ALICE, W1));
    assert.equal(anon.ok, false);
  });

  test("RLS is on for all three", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity from pg_class
       where relname in ('referral_codes', 'campaign_referrals', 'campaign_usdc_claims') order by 1`);
    assert.equal(rows.length, 3);
    for (const r of rows) assert.equal(r.relrowsecurity, true, r.relname);
  });
});

describe("referrals", () => {
  test("a malformed code is refused", async () => {
    await assert.rejects(
      asService(async (q) => {
        await q(`insert into public.referral_codes (user_id, code) values ('${BOB}', 'abc')`);
      }),
    );
  });

  test("self-referral is refused", async () => {
    await assert.rejects(
      asService(async (q) => {
        await q(`insert into public.campaign_referrals (referrer_id, referred_user_id, code)
                 values ('${ALICE}', '${ALICE}', 'ABCD2345')`);
      }),
    );
  });

  test("an account is counted as referred once", async () => {
    await assert.rejects(
      asService(async (q) => {
        await q(`insert into public.campaign_referrals (referrer_id, referred_user_id, code)
                 values ('${ALICE}', '${BOB}', 'ABCD2345')`);
        await q(`insert into public.campaign_referrals (referrer_id, referred_user_id, code)
                 values ('${CAROL}', '${BOB}', 'ZZZZ2345')`);
      }),
      /duplicate key|unique/,
    );
  });
});

describe("practice-USDC claims", () => {
  type Row = { outcome: string; claim_id: number | null };

  test("the first claim is reserved, a second for the same account is refused", async () => {
    await asService<Row>(async (q) => {
      assert.equal((await q(reserve(ALICE, W1)))[0].outcome, "reserved");
      assert.equal((await q(reserve(ALICE, W2)))[0].outcome, "already-claimed");
    });
  });

  test("a wallet already paid cannot be claimed again from another account", async () => {
    await asService<Row>(async (q) => {
      assert.equal((await q(reserve(ALICE, W1)))[0].outcome, "reserved");
      assert.equal((await q(reserve(BOB, W1)))[0].outcome, "already-claimed");
    });
  });

  test("a failed claim frees the account and wallet to try again", async () => {
    await asService<Row>(async (q) => {
      const first = (await q(reserve(ALICE, W1)))[0];
      await q(`update public.campaign_usdc_claims set status = 'failed' where id = ${first.claim_id}`);
      assert.equal((await q(reserve(ALICE, W1)))[0].outcome, "reserved");
    });
  });

  test("the daily cap holds across accounts", async () => {
    await asService<Row>(async (q) => {
      assert.equal((await q(reserve(ALICE, W1, 2)))[0].outcome, "reserved");
      assert.equal((await q(reserve(BOB, W2, 2)))[0].outcome, "reserved");
      assert.equal((await q(reserve(CAROL, W3, 2)))[0].outcome, "daily-cap");
    });
  });

  test("yesterday's claims do not count toward today's cap", async () => {
    await asService<Row>(async (q) => {
      const first = (await q(reserve(ALICE, W1, 1)))[0];
      await q(`update public.campaign_usdc_claims set created_at = now() - interval '2 days' where id = ${first.claim_id}`);
      assert.equal((await q(reserve(DAVE, W2, 1)))[0].outcome, "reserved");
    });
  });

  test("a malformed wallet address is refused", async () => {
    await assert.rejects(
      asService(async (q) => {
        await q(reserve(ALICE, "not-a-wallet"));
      }),
    );
  });
});
