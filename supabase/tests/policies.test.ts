// Abuse-case tests for the database layer: each one tries, as a browser
// session, a write or read that a migration was written to refuse, and checks
// that it is refused while the legitimate version of the same action still
// works. Threat IDs refer to threat-register-blkfndr.md (Gate 4, 4.1-abuse).
//
// Run with `npm run test:db`. Nothing here touches a real database.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { as, migrationFiles, replay, type Claims, type Outcome } from "./replay.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const PLATFORM_ADMIN = "00000000-0000-4000-8000-000000000002";
const ALICE = "00000000-0000-4000-8000-000000000003";
const BOB = "00000000-0000-4000-8000-000000000004";
const INVITEE = "00000000-0000-4000-8000-000000000005";

const owner: Claims = { sub: OWNER, email: "owner@example.test" };
const platformAdmin: Claims = { sub: PLATFORM_ADMIN, email: "padmin@example.test" };
const alice: Claims = { sub: ALICE, email: "alice@example.test" };
const bob: Claims = { sub: BOB, email: "bob@example.test" };
const invitee: Claims = { sub: INVITEE, email: "invitee@example.test" };

const OPEN_REQUEST = "10000000-0000-4000-8000-000000000001";
const PLANNED_REQUEST = "10000000-0000-4000-8000-000000000002";

let db: PGlite;

/** Seeded as the migration owner, the way the service role would write them. */
const SEED = `
insert into public.platform_admins (email, role, note) values
  ('owner@example.test', 'owner', 'test owner'),
  ('padmin@example.test', 'platform_admin', 'test platform admin'),
  ('invitee@example.test', 'owner', 'invite, not yet confirmed');

insert into auth.users (id, email, email_confirmed_at) values
  ('${OWNER}', 'owner@example.test', now()),
  ('${PLATFORM_ADMIN}', 'padmin@example.test', now()),
  ('${ALICE}', 'alice@example.test', now()),
  ('${BOB}', 'bob@example.test', now()),
  ('${INVITEE}', 'invitee@example.test', null);

insert into public.kyc_requests
  (user_id, stellar_address, full_name, email, details_hash, document_path, document_type, consent_given)
values
  ('${BOB}', 'GBOBTESTADDRESS', 'Bob Example', 'bob@example.test', 'hash', 'bob/id.png', 'passport', true);

insert into public.feature_requests (id, title, submitted_by, status) values
  ('${OPEN_REQUEST}', 'An open request', '${ALICE}', 'open'),
  ('${PLANNED_REQUEST}', 'A planned request', '${ALICE}', 'planned');
`;

function assertRefused(o: Outcome, what: string) {
  assert.equal(o.ok, false, `${what} should be refused, but it ran`);
}

function assertNoRowChanged(o: Outcome, what: string) {
  if (o.ok) assert.equal(o.affected, 0, `${what} should change no row, but changed ${o.affected}`);
}

function assertRan(o: Outcome, what: string): Record<string, unknown>[] {
  assert.ok(o.ok, `${what} should succeed: ${o.ok ? "" : o.message}`);
  return o.rows;
}

before(async () => {
  db = await replay();
  await db.exec(SEED);
});

after(async () => {
  await db?.close();
});

describe("BF-M-09: a clean replay", () => {
  test("every migration applies, in version order, to an empty database", () => {
    // replay() in before() threw on the first failing file otherwise.
    assert.ok(db);
  });

  test("migration versions are unique", () => {
    const versions = migrationFiles().map((f) => f.slice(0, 14));
    assert.deepEqual(versions, [...new Set(versions)]);
  });
});

describe("BF-H-05: a user cannot link a wallet to their own profile", () => {
  test("self-update of stellar_public_key is refused", async () => {
    const o = await as(db, "authenticated", alice,
      `update public.profiles set stellar_public_key = 'GFORGEDADDRESS' where id = $1`, [ALICE]);
    assertRefused(o, "setting your own stellar_public_key");
  });

  test("self-update of wallet_status is refused", async () => {
    const o = await as(db, "authenticated", alice,
      `update public.profiles set wallet_status = 'connected' where id = $1`, [ALICE]);
    assertRefused(o, "setting your own wallet_status");
  });

  test("an admin cannot set another user's wallet either", async () => {
    const o = await as(db, "authenticated", owner,
      `update public.profiles set stellar_public_key = 'GFORGEDADDRESS' where id = $1`, [ALICE]);
    assertRefused(o, "an owner setting a user's stellar_public_key");
  });

  test("display fields stay editable", async () => {
    const o = await as(db, "authenticated", alice,
      `update public.profiles set display_name = 'Alice' where id = $1`, [ALICE]);
    assertRan(o, "renaming yourself");
    assert.equal(o.ok && o.affected, 1);
  });
});

describe("G4-R6: no browser table writes for anon", () => {
  test("anon holds no INSERT, UPDATE, DELETE or TRUNCATE on any public table", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type
        from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      union
      select table_name, privilege_type
        from information_schema.column_privileges
       where grantee = 'anon' and table_schema = 'public'
         and privilege_type in ('INSERT', 'UPDATE')
       order by 1, 2`);
    assert.deepEqual(rows, []);
  });

  test("authenticated holds no TRUNCATE on any public table", async () => {
    const { rows } = await db.query(`
      select table_name from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'TRUNCATE'`);
    assert.deepEqual(rows, []);
  });

  test("anon cannot file a feature request", async () => {
    const o = await as(db, "anon", null,
      `insert into public.feature_requests (title, submitted_by) values ('spam', $1)`, [ALICE]);
    assertRefused(o, "an anonymous insert");
  });

  test("anon cannot delete projects", async () => {
    const o = await as(db, "anon", null, `delete from public.projects`);
    assertRefused(o, "an anonymous delete");
  });
});

describe("G4-M1: only an owner bans someone on the roster", () => {
  test("a platform_admin cannot ban an owner", async () => {
    const o = await as(db, "authenticated", platformAdmin,
      `insert into public.platform_bans (user_id, reason) values ($1, 'x')`, [OWNER]);
    assertRefused(o, "a platform_admin banning an owner");
  });

  test("a platform_admin cannot ban themselves", async () => {
    const o = await as(db, "authenticated", platformAdmin,
      `insert into public.platform_bans (user_id, reason) values ($1, 'x')`, [PLATFORM_ADMIN]);
    assertRefused(o, "a self-ban");
  });

  test("an owner cannot ban themselves", async () => {
    const o = await as(db, "authenticated", owner,
      `insert into public.platform_bans (user_id, reason) values ($1, 'x')`, [OWNER]);
    assertRefused(o, "an owner's self-ban");
  });

  test("a ban cannot be re-pointed at an owner after it is written", async () => {
    await db.exec(`insert into public.platform_bans (user_id, reason) values ('${BOB}', 'seeded')`);
    try {
      const o = await as(db, "authenticated", platformAdmin,
        `update public.platform_bans set user_id = $1 where user_id = $2`, [OWNER, BOB]);
      assert.ok(!o.ok || o.affected === 0, "re-pointing a ban at an owner should be refused");
    } finally {
      await db.exec(`delete from public.platform_bans where user_id = '${BOB}'`);
    }
  });

  test("a platform_admin can ban an ordinary user, recorded as the banner", async () => {
    const o = await as(db, "authenticated", platformAdmin,
      `insert into public.platform_bans (user_id, banned_by, reason) values ($1, $2, 'spam')
       returning banned_by`, [ALICE, OWNER]);
    const rows = assertRan(o, "banning an ordinary user");
    assert.equal(rows[0].banned_by, PLATFORM_ADMIN, "banned_by is the caller, not what the client sent");
  });

  test("an owner can ban a platform_admin", async () => {
    const o = await as(db, "authenticated", owner,
      `insert into public.platform_bans (user_id, reason) values ($1, 'x')`, [PLATFORM_ADMIN]);
    assertRan(o, "an owner banning a platform_admin");
  });

  test("anyone off the roster cannot ban at all", async () => {
    const o = await as(db, "authenticated", alice,
      `insert into public.platform_bans (user_id, reason) values ($1, 'x')`, [BOB]);
    assertRefused(o, "an ordinary user banning someone");
  });
});

describe("G4-F1: an admin invite binds only to a confirmed email", () => {
  test("signing up with an invited address does not bind the invite", async () => {
    const { rows } = await db.query<{ user_id: string | null }>(
      `select user_id from public.platform_admins where email = 'invitee@example.test'`);
    assert.equal(rows[0].user_id, null);
  });

  test("the unconfirmed account holds no role", async () => {
    const o = await as(db, "authenticated", invitee,
      `select public.is_admin() as admin, public.is_owner() as owner, public.my_role() as role,
              public.has_admin_role('owner') as has_owner`);
    const [r] = assertRan(o, "reading your own role");
    assert.deepEqual(r, { admin: false, owner: false, role: null, has_owner: false });
  });

  test("the unconfirmed account cannot use an owner's power", async () => {
    const o = await as(db, "authenticated", invitee,
      `insert into public.platform_bans (user_id, reason) values ($1, 'x')`, [ALICE]);
    assertRefused(o, "an unconfirmed invitee banning a user");
  });

  test("confirming the email binds the invite and grants the role", async () => {
    await db.transaction(async (tx) => {
      await tx.exec(`update auth.users set email_confirmed_at = now() where id = '${INVITEE}'`);
      const bound = await tx.query<{ user_id: string | null }>(
        `select user_id from public.platform_admins where email = 'invitee@example.test'`);
      assert.equal(bound.rows[0].user_id, INVITEE);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(invitee)]);
      await tx.exec("set local role authenticated");
      const role = await tx.query<{ owner: boolean }>(`select public.is_owner() as owner`);
      assert.equal(role.rows[0].owner, true);
      await tx.rollback();
    });
  });
});

describe("G4-L2: only the owners' vote plans or declines a feature request", () => {
  for (const [who, claims] of [["a platform_admin", platformAdmin], ["the submitter", alice]] as const) {
    test(`${who} cannot set status`, async () => {
      const o = await as(db, "authenticated", claims,
        `update public.feature_requests set status = 'planned' where id = $1`, [OPEN_REQUEST]);
      assertNoRowChanged(o, `${who} planning a request`);
    });
  }

  test("an owner cannot set status directly either", async () => {
    const o = await as(db, "authenticated", owner,
      `update public.feature_requests set status = 'declined' where id = $1`, [OPEN_REQUEST]);
    assertRefused(o, "an owner declining a request without the vote");
  });

  test("an owner can write the response note", async () => {
    const o = await as(db, "authenticated", owner,
      `update public.feature_requests set response = 'thanks' where id = $1`, [OPEN_REQUEST]);
    assertRan(o, "an owner responding");
    assert.equal(o.ok && o.affected, 1);
  });

  test("an owner can mark a planned request shipped", async () => {
    const o = await as(db, "authenticated", owner,
      `update public.feature_requests set status = 'shipped' where id = $1`, [PLANNED_REQUEST]);
    assertRan(o, "shipping a planned request");
    assert.equal(o.ok && o.affected, 1);
  });
});

describe("BF-H-04: no browser read of other applicants' KYC checks", () => {
  test("an owner's session reads no KYC request", async () => {
    const o = await as(db, "authenticated", owner, `select id, status from public.kyc_requests`);
    if (o.ok) assert.deepEqual(o.rows, []);
  });

  test("an owner's session cannot approve a check", async () => {
    const o = await as(db, "authenticated", owner,
      `update public.kyc_requests set status = 'approved' where user_id = $1`, [BOB]);
    assertNoRowChanged(o, "an owner approving a check from the browser");
  });

  test("anon reads no KYC request", async () => {
    const o = await as(db, "anon", null, `select id from public.kyc_requests`);
    if (o.ok) assert.deepEqual(o.rows, []);
  });

  test("the applicant still sees their own check", async () => {
    const o = await as(db, "authenticated", bob, `select status from public.kyc_requests`);
    assert.deepEqual(assertRan(o, "reading your own check"), [{ status: "pending" }]);
  });
});
