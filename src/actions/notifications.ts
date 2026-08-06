"use server";

import {
  createNotification as dbCreateNotification,
  dismissNotification as dbDismissNotification,
  dismissAllNotifications as dbDismissAllNotifications,
  markNotificationsAsRead as dbMarkNotificationsAsRead,
  getUserByCreatorId,
  getProjectById
} from "@/lib/data";
import { getSession } from "@/lib/auth/session";

export async function createNotification(
  userId: string,
  title: string,
  caption: string,
  url: string | null = null,
  objectId: string | null = null,
) {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const callerUid = session.user.uid;

  // Validate authorization for notification creation
  if (userId !== callerUid) {
    // heck if caller is admin
    const callerRecord = await getUserByCreatorId(callerUid, "uid");
    const isCallerAdmin = callerRecord?.role === "admin";

    if (!isCallerAdmin) {
      // Check if target user is admin
      const targetRecord = await getUserByCreatorId(userId, "uid");
      const isTargetAdmin = targetRecord?.role === "admin";

      if (!isTargetAdmin) {
        // Check if target user is the creator of the associated project
        let isProjectCreator = false;
        if (objectId) {
          const project = await getProjectById(objectId);
          if (project) {
            const creatorAddr = project.creatorAddress || project.creator;
            if (creatorAddr) {
              const creatorRecord = await getUserByCreatorId(creatorAddr, "stellarPublicKey");
              if (creatorRecord && creatorRecord.uid === userId) {
                isProjectCreator = true;
              }
            }
          }
        }
        if (!isProjectCreator) {
          throw new Error("Unauthorized to create notification for this user");
        }
      }
    }
  }

  return dbCreateNotification(userId, title, caption, url, objectId);
}

export async function dismissNotification(notificationId: string) {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return dbDismissNotification(notificationId, session.user.uid);
}

export async function dismissAllNotifications(userAddress: string) {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  let targetUid = userAddress;
  if (userAddress !== session.user.uid) {
    const user = await getUserByCreatorId(userAddress, "stellarPublicKey");
    if (user) {
      targetUid = user.uid;
    }
  }

  if (targetUid !== session.user.uid) {
    throw new Error("Unauthorized to dismiss notifications for another user");
  }

  return dbDismissAllNotifications(targetUid);
}

export async function markNotificationsAsRead(notificationIds: string[]) {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return dbMarkNotificationsAsRead(notificationIds, session.user.uid);
}