"use server";

import { markRead, dismiss, dismissAll } from "@/lib/data/notifications";

// Each of these is scoped to the caller by RLS. There is no longer an argument
// naming whose notifications to touch, so there is nothing to forge.

export async function markNotificationsAsRead(ids: string[]) {
  return markRead(ids);
}

export async function dismissNotification(id: string) {
  return dismiss(id);
}

export async function dismissAllNotifications() {
  return dismissAll();
}

// `notify` is intentionally NOT re-exported here. It performs a service-role
// insert with no authorization, so exposing it from a "use server" file made it
// an unauthenticated public endpoint (arbitrary-recipient notification / in-app
// phishing). It stays internal to the server-only data layer; any client-facing
// notification must go through an action that authenticates and forces the
// recipient from the session.
