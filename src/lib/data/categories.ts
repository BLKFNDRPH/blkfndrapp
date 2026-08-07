import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";

/**
 * The categories a builder can pick from when creating a listing.
 *
 * These were a hardcoded array, so editing the list meant editing code. The
 * table is readable by anyone and writable only by an admin, enforced by RLS
 * rather than by these functions — requireAdmin below is the second line, not
 * the only one.
 *
 * Removing a category does not touch projects already using it. `projects.category`
 * is plain text on purpose, so retiring a category stops it being offered without
 * rewriting listings that were created under it.
 */

const NameSchema = z
  .string()
  .trim()
  .min(2, "Category name is too short.")
  .max(40, "Category name is too long.")
  // Deliberately narrow. These render in a filter row and a dropdown, and a
  // name carrying newlines or angle brackets is far more likely to be an
  // accident or an attempt at markup than a real category.
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} &/'’.\-]*$/u,
    "Use letters, numbers, spaces and & / ' . - only.",
  );

/** Readable signed out — the create-listing form and explore filters both need it. */
export async function listCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_categories")
    .select("name")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load categories: ${error.message}`);
  return (data ?? []).map((r) => r.name);
}

export async function addCategory(name: string): Promise<string[]> {
  await requireAdmin();
  const parsed = NameSchema.parse(name);

  const admin = createAdminClient();
  const { error } = await admin.from("project_categories").insert({ name: parsed });

  if (error) {
    // The unique index is on lower(name), so this is the case-insensitive
    // duplicate rather than a generic write failure. Saying so is more useful
    // than surfacing a constraint name.
    if (error.code === "23505") {
      throw new Error(`"${parsed}" already exists.`);
    }
    throw new Error(`Could not add category: ${error.message}`);
  }
  return listCategories();
}

export async function removeCategory(name: string): Promise<string[]> {
  await requireAdmin();
  const parsed = NameSchema.parse(name);

  const admin = createAdminClient();
  const { error } = await admin
    .from("project_categories")
    .delete()
    .ilike("name", parsed);

  if (error) throw new Error(`Could not remove category: ${error.message}`);
  return listCategories();
}
