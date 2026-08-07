"use server";

import {
  listCategories,
  addCategory,
  removeCategory,
} from "@/lib/data/categories";
import { authFailure } from "@/lib/auth/guards";

/**
 * Every exported async function in a "use server" file is a public HTTP
 * endpoint reachable by action id, whether or not any component calls it. The
 * authorization lives in the DAL (requireAdmin) and in RLS; these wrappers only
 * turn a thrown AuthError into a result the client can render.
 */

export async function getCategoriesAction() {
  try {
    return { success: true as const, categories: await listCategories() };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false as const,
        error: error instanceof Error ? error.message : "Could not load categories.",
      }
    );
  }
}

export async function addCategoryAction(name: string) {
  try {
    return { success: true as const, categories: await addCategory(name) };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false as const,
        error: error instanceof Error ? error.message : "Could not add category.",
      }
    );
  }
}

export async function removeCategoryAction(name: string) {
  try {
    return { success: true as const, categories: await removeCategory(name) };
  } catch (error) {
    return (
      authFailure(error) ?? {
        success: false as const,
        error: error instanceof Error ? error.message : "Could not remove category.",
      }
    );
  }
}
