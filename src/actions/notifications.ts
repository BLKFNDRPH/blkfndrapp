"use server";

import { markRead, dismiss, dismissAll, notify } from "@/lib/data/notifications";

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

export { notify as createNotification };
