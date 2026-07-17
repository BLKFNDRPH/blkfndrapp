import { createNotification as serverCreateNotification } from "./notifications";

export async function createNotification(
  userId: string,
  title: string,
  caption: string,
  url: string | null = null,
  objectId: string | null = null,
) {
  const result = await serverCreateNotification(userId, title, caption, url, objectId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("refresh-notifications"));
  }
  return result;
}
