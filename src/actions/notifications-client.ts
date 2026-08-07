"use client";

/**
 * Client-side helpers for notifications.
 *
 * Creating a notification for another user is a server-side concern — there is
 * no insert policy for browser-facing roles — so this file only exposes the
 * read and dismiss paths, each of which RLS confines to the caller.
 */

export async function fetchNotifications() {
  const res = await fetch("/api/notifications");
  if (!res.ok) return [];
  return res.json();
}

export async function markNotificationsRead(ids: string[]) {
  await fetch("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

export async function dismissNotification(id: string) {
  await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function dismissAllNotifications() {
  await fetch("/api/notifications?all=true", { method: "DELETE" });
}
