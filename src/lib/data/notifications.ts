import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller } from "@/lib/supabase/auth";
import { PROJECT_RESTRICTOR_ROLES, type AdminRole } from "@/lib/admin-roles";

/**
 * Notifications. Replaces the Mongo `notifications` collection.
 *
 * The IDOR that collection had — updateMany by id with no ownership filter —
 * is not expressible here: every read, update and delete goes through the
 * caller's own client, and the RLS policies scope each statement to their rows.
 * A missing `.eq('user_id', ...)` no longer changes what happens.
 */

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  caption: string;
  url: string | null;
  project_id: string | null;
  is_read: boolean;
  created_at: string;
  /**
   * The project's public number, the one its page is addressed by. project_id
   * is the row's uuid, and a link built from it went to "We can't find that
   * project". Null when there is no project, or it is hidden from the reader.
   */
  project_number?: string | null;
}

export async function listOwnNotifications(): Promise<Notification[]> {
  await requireCaller();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("*, projects(project_id)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return (data ?? []).map((row) => {
    const { projects, ...rest } = row as typeof row & { projects: { project_id: string } | null };
    return { ...rest, project_number: projects?.project_id ?? null } as Notification;
  });
}

export async function markRead(ids: string[]) {
  await requireCaller();
  const parsed = z.array(z.string().uuid()).max(200).parse(ids);
  if (parsed.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .in("id", parsed);

  if (error) throw new Error(`Could not mark notifications read: ${error.message}`);
}

export async function dismiss(id: string) {
  await requireCaller();
  z.string().uuid().parse(id);

  const supabase = await createClient();
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw new Error(`Could not dismiss notification: ${error.message}`);
}

export async function dismissAll() {
  await requireCaller();
  const supabase = await createClient();
  // No filter needed: the delete policy already confines this to the caller.
  const { error } = await supabase.from("notifications").delete().neq("id", "");
  if (error) throw new Error(`Could not clear notifications: ${error.message}`);
}

/**
 * Create a notification for someone else.
 *
 * Service-role, because the recipient is by definition not the caller and no
 * insert policy exists for browser-facing roles. Every call site here is
 * server-side and already knows who it is notifying and why.
 */
export async function notify(input: {
  userId: string;
  title: string;
  caption?: string;
  url?: string | null;
  projectId?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    user_id: input.userId,
    title: input.title.slice(0, 200),
    caption: (input.caption ?? "").slice(0, 1000),
    url: input.url ?? null,
    project_id: input.projectId ?? null,
  });

  if (error) {
    // A failed notification must never fail the operation that triggered it.
    console.error("[notifications] Could not create:", error.message);
  }
}

/**
 * Notify the admins who look after projects — the roles that may hide and lock
 * one (PROJECT_RESTRICTOR_ROLES). Used for project events that need human
 * attention, which a KYC attestor or an accountant could not act on.
 *
 * Recipients come from the platform_admins roster — the one requireCaller()
 * asks. This used to filter auth users on app_metadata.role, which is set only
 * when a linked wallet is on the on-chain admin roster, so a console admin with
 * no such wallet (a Project Administrator, say) was never told.
 */
export async function notifyAdmins(
  title: string,
  caption: string,
  projectId?: string,
  /** Who to tell. Project events by default; identity events pass the KYC reviewers. */
  roles: readonly AdminRole[] = PROJECT_RESTRICTOR_ROLES,
) {
  const admin = createAdminClient();

  // A row with no user_id is an invite whose holder has not signed in yet, so
  // there is no account to notify.
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .in("role", roles)
    .not("user_id", "is", null);
  if (error) {
    console.error("[notifications] Could not list admins:", error.message);
    return;
  }

  const adminIds = (data ?? []).flatMap((r) => (r.user_id ? [r.user_id] : []));

  if (adminIds.length === 0) return;

  const { error: insertError } = await admin.from("notifications").insert(
    adminIds.map((id) => ({
      user_id: id,
      title: title.slice(0, 200),
      caption: caption.slice(0, 1000),
      project_id: projectId ?? null,
    })),
  );

  if (insertError) {
    console.error("[notifications] Could not notify admins:", insertError.message);
  }
}
