// Replays supabase/migrations into an in-memory Postgres (PGlite) the way
// `supabase db reset` would: every file, in version order, on top of a small
// stand-in for what Supabase provides before the first migration runs.
//
// The stand-in covers only what the migrations and the policy tests touch:
//   * the anon / authenticated / service_role roles, with Supabase's default
//     privileges (every new public table and function is granted to all three,
//     which is why so many migrations start by revoking);
//   * auth.users, auth.uid() and auth.jwt(), read from request.jwt.claims the
//     way PostgREST sets it;
//   * the storage and vault objects that migrations reference;
//   * rls_auto_enable, which live runs as an event trigger to turn RLS on for
//     every new public table.
//
// The repo's file versions match the versions recorded on live (BF-M-09), so
// version order here is live order.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

const SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  banned_until       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
grant select on auth.users to service_role;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
    from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language sql as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description),
         updated_at = now()
   where id = secret_id
$$;

create function public.rls_auto_enable() returns event_trigger language plpgsql as $$
declare
  cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
     where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
       and object_type in ('table', 'partitioned table')
       and schema_name = 'public'
  loop
    execute format('alter table if exists %s enable row level security', cmd.object_identity);
  end loop;
end;
$$;
`;

// PGlite runs Postgres in single-user mode, where event triggers never fire.
// So rls_auto_enable's effect is applied after each migration instead: any
// public table without RLS gets it, exactly as the live trigger would have
// done when the table was created.
const ENABLE_RLS_ON_NEW_TABLES = `
do $$
declare t record;
begin
  for t in
    select c.oid::regclass as rel
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table %s enable row level security', t.rel);
  end loop;
end;
$$;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export class MigrationError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    super(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.file = file;
  }
}

/** A fresh database with every migration applied, in version order. */
export async function replay(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SHIM);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      await db.exec(ENABLE_RLS_ON_NEW_TABLES);
    } catch (err) {
      await db.close();
      throw new MigrationError(file, err);
    }
  }
  return db;
}

export type Claims = { sub: string; email?: string; role?: string };

export type Outcome =
  | { ok: true; rows: Record<string, unknown>[]; affected: number }
  | { ok: false; code: string; message: string };

/**
 * Runs one statement as a browser session would reach it through PostgREST:
 * as `anon`, or as `authenticated` with the caller's JWT claims. The statement
 * runs in its own transaction, which is always rolled back, so one probe never
 * changes the data the next probe sees.
 */
export async function as(
  db: PGlite,
  role: "anon" | "authenticated",
  claims: Claims | null,
  sql: string,
  params: unknown[] = [],
): Promise<Outcome> {
  let outcome: Outcome | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        claims ? JSON.stringify({ role, ...claims }) : "",
      ]);
      await tx.exec(`set local role ${role}`);
      const res = await tx.query<Record<string, unknown>>(sql, params);
      outcome = { ok: true, rows: res.rows, affected: res.affectedRows ?? 0 };
      await tx.rollback();
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    outcome = { ok: false, code: e.code ?? "", message: e.message ?? String(err) };
  }
  return outcome!;
}
