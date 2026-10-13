import "server-only";

import { cookies } from "next/headers";
import { createAnonClient } from "@/lib/supabase/anon";
import { createReadCache } from "@/lib/read-cache";
import { getProjectById, getProjects } from "@/lib/data/projects";
import { listCategories } from "@/lib/data/categories";
import type { Project } from "@/lib/types";

/**
 * The project data a page renders, shared between signed-out visitors.
 *
 * The database is in Tokyo (ap-northeast-1), and every read costs about
 * 0.3 s from the host. Since #168 and #170, /projects and the project page
 * read their data before they send a byte, so on live their first byte took
 * 0.4–0.6 s against 0.13 s for the home page.
 *
 * A signed-out visitor sees exactly what any other signed-out visitor sees,
 * so their reads are made once with a session-less client and shared: fresh
 * for 30 s, then served while a fresh read runs behind them for up to five
 * minutes more. Nothing here is the last word on money: the project page
 * still reads the vault's live figures in the browser, and the app's shared
 * list is fetched again on the client.
 *
 * Someone signed in may see more (a hidden listing they build or stake in, or
 * any listing as an admin), so their reads go through their own session as
 * before, uncached.
 */

const FRESH_MS = 30_000;
const STALE_MS = 5 * 60_000;

const reads = createReadCache(100);

/**
 * Whether the request carries a Supabase session. Read from the cookie names
 * alone, without a network call: the session cookie is sb-<ref>-auth-token,
 * split into .0, .1 … when large. A stale or invalid cookie only means the
 * visitor takes the uncached path, which is always correct.
 */
async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  return jar.getAll().some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
}

function shared<T>(key: string, read: () => Promise<T>): Promise<T> {
  return reads.cachedRead(key, FRESH_MS, read, { staleMs: STALE_MS });
}

/** Every project the visitor may see, as /projects lists them. */
export async function readProjectsForVisitor(): Promise<Project[]> {
  if (await hasSession()) return getProjects();
  // getProjects answers [] when the database errors. An empty list is never
  // kept, so a hiccup cannot show every signed-out visitor an empty catalogue
  // for minutes; there are always listings on a running platform.
  const list = await shared("projects", async () => {
    const projects = await getProjects(createAnonClient());
    return projects.length > 0 ? projects : null;
  });
  return list ?? [];
}

/** The listing categories, the same for everyone. */
export async function readCategoriesForVisitor(): Promise<string[]> {
  // The list is public for everyone, signed in or not.
  return shared("categories", () => listCategories(createAnonClient()));
}

/** One project, or null when the visitor may not see it or it does not exist. */
export async function readProjectForVisitor(id: string): Promise<Project | null> {
  if (await hasSession()) return (await getProjectById(id)) ?? null;
  // getProjectById answers undefined for a missing project; the cache keeps no
  // null or undefined answer, so a project that appears is found next time.
  return shared(`project:${id}`, async () => (await getProjectById(id, createAnonClient())) ?? null);
}
