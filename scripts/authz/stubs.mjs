// Stand-ins for the modules that reach outside the process, used by
// scripts/authz-check.mjs. Everything else in a route or action runs for real:
// the guards in @/lib/supabase/auth and @/lib/auth/guards, and every data
// function behind them.
//
// The caller is whoever globalThis.__authz.who says: null for signed out, or
// { sub, email, role } where role is an admin role or null. The session
// client answers getClaims and the role functions (my_role, has_admin_role,
// is_admin, is_owner) as the real database would for that caller. Reads come
// back empty. Every write, storage call, auth call, other RPC and outbound
// fetch is recorded in globalThis.__authz.effects, which is what the check
// asserts on: a refused caller must cause none.

export const authz = (globalThis.__authz ??= { who: null, effects: [] });

const record = (what) => authz.effects.push(what);

function query(table, client) {
  let op = "select";
  const q = {
    select: () => q,
    insert: () => ((op = "insert"), q),
    update: () => ((op = "update"), q),
    upsert: () => ((op = "upsert"), q),
    delete: () => ((op = "delete"), q),
    maybeSingle: () => ((q.single = true), q),
    single: () => ((q.single = true), q),
    then(resolve, reject) {
      if (op !== "select") record(`${client}: ${op} ${table}`);
      const data = op === "select" ? (q.single ? null : []) : null;
      return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
    },
    throwOnError: () => q,
  };
  // Filters, ordering and paging change nothing here.
  for (const name of [
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not", "or", "and", "filter", "match",
    "like", "ilike", "contains", "containedBy", "overlaps", "textSearch", "order", "limit", "range",
    "returns", "csv", "abortSignal",
  ]) q[name] = () => q;
  return q;
}

function storage(client) {
  const bucket = (name) => ({
    upload: async () => (record(`${client}: storage upload ${name}`), { data: null, error: { message: "stub" } }),
    remove: async () => (record(`${client}: storage remove ${name}`), { data: null, error: null }),
    move: async () => (record(`${client}: storage move ${name}`), { data: null, error: null }),
    createSignedUrl: async () => (record(`${client}: storage sign ${name}`), { data: null, error: { message: "stub" } }),
    createSignedUploadUrl: async () => (record(`${client}: storage sign-upload ${name}`), { data: null, error: { message: "stub" } }),
    download: async () => (record(`${client}: storage download ${name}`), { data: null, error: { message: "stub" } }),
    list: async () => ({ data: [], error: null }),
    getPublicUrl: () => ({ data: { publicUrl: "" } }),
  });
  return { from: bucket };
}

function roleAnswer(name, args) {
  const role = authz.who?.role ?? null;
  switch (name) {
    case "my_role": return role;
    case "is_admin": return role !== null;
    case "is_owner": return role === "owner";
    case "has_admin_role": return role !== null && (role === args?.wanted || role === "owner");
    default: return undefined;
  }
}

function authApi(client) {
  const recorded = (name) => async () => (record(`${client}: auth.${name}`), { data: { user: null, session: null, url: null }, error: { message: "stub" } });
  return new Proxy(
    {
      getClaims: async () =>
        authz.who
          ? { data: { claims: { sub: authz.who.sub, email: authz.who.email } }, error: null }
          : { data: null, error: { message: "Auth session missing!" } },
      getUser: async () =>
        authz.who
          ? { data: { user: { id: authz.who.sub, email: authz.who.email } }, error: null }
          : { data: { user: null }, error: { message: "Auth session missing!" } },
      getSession: async () => ({ data: { session: null }, error: null }),
      admin: new Proxy({}, { get: (_, name) => recorded(`admin.${String(name)}`) }),
    },
    { get: (target, name) => (name in target ? target[name] : recorded(String(name))) },
  );
}

function client(kind) {
  return {
    from: (table) => query(table, kind),
    rpc: (name, args) => {
      const answer = kind === "session" ? roleAnswer(name, args) : undefined;
      if (answer === undefined) record(`${kind}: rpc ${name}`);
      const result = { data: answer ?? null, error: null };
      const thenable = { then: (res, rej) => Promise.resolve(result).then(res, rej), throwOnError: () => thenable };
      return thenable;
    },
    storage: storage(kind),
    auth: authApi(kind),
    schema: () => client(kind),
  };
}

// @/lib/supabase/server and @/lib/supabase/admin
export async function createClient() { return client("session"); }
export function createAdminClient() { return client("service"); }

// next/headers
const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false };
export async function cookies() { return jar; }
export async function headers() { return new Headers({ host: "localhost:9002" }); }

// next/cache
export function revalidatePath() {}
export function revalidateTag() {}
export function unstable_cache(fn) { return fn; }

// next/navigation
export function redirect(url) { const e = new Error(`NEXT_REDIRECT ${url}`); e.digest = "NEXT_REDIRECT"; throw e; }
export function notFound() { const e = new Error("NEXT_NOT_FOUND"); e.digest = "NEXT_NOT_FOUND"; throw e; }

// next/server: just enough of NextRequest/NextResponse over the platform ones.
export class NextRequest extends Request {
  get nextUrl() { return new URL(this.url); }
  get cookies() { return jar; }
}
export class NextResponse extends Response {
  static json(body, init = {}) {
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  }
  static redirect(url, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
  static next() { return new NextResponse(null, { status: 200 }); }
  get cookies() { return jar; }
}
export function after() {}

// @/ai/flows/improve-listing-quality
export async function improveListingQuality() { record("ai: improveListingQuality"); return null; }
