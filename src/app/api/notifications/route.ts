import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import Notification from '@/lib/models/Notification';
import User from '@/lib/models/User';
import { getSession } from '@/lib/auth/session';

// GET /api/notifications — fetch all notifications for the current user

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const uid = session.user.uid;
  await connectToDatabase();

  const notifs = await Notification.find({ userId: uid })
    .sort({ timestamp: -1 })
    .lean();

  const formatted = notifs.map((n: any) => ({
    id: n._id.toString(),
    userId: n.userId,
    title: n.title,
    caption: n.caption,
    timestamp: n.timestamp,
    isRead: n.isRead,
    url: n.url,
    object: n.object,
  }));

  return NextResponse.json(formatted);
}

// POST /api/notifications — create a notification
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { userId, title, caption, url = null, object = null } = body;

  if (!userId || !title) {
    return NextResponse.json({ error: 'userId and title are required' }, { status: 400 });
  }

  await connectToDatabase();

  const callerUid = session.user.uid;

  if (userId !== callerUid) {
    const callerRecord = await User.findOne({ uid: callerUid }).lean();
    const isCallerAdmin = callerRecord?.role === 'admin';

    if (!isCallerAdmin) {
      const targetRecord = await User.findOne({ uid: userId }).lean();
      const isTargetAdmin = targetRecord?.role === 'admin';

      if (!isTargetAdmin) {
        let isProjectCreator = false;
        if (object) {
          const { getProjectById } = await import('@/lib/data');
          const project = await getProjectById(object);
          if (project) {
            const creatorAddr = project.creatorAddress || project.creator;
            if (creatorAddr) {
              const creatorRecord = await User.findOne({ stellarPublicKey: creatorAddr }).lean();
              if (creatorRecord && creatorRecord.uid === userId) {
                isProjectCreator = true;
              }
            }
          }
        }
        if (!isProjectCreator) {
          return NextResponse.json({ error: 'Unauthorized to create notification for this user' }, { status: 403 });
        }
      }
    }
  }

  const notif = await Notification.create({
    userId,
    title,
    caption,
    timestamp: Date.now(),
    isRead: false,
    url,
    object,
  });

  return NextResponse.json({ id: notif._id.toString() }, { status: 201 });
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { ids } = body as { ids: string[] };

  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: 'No ids provided' }, { status: 400 });
  }

  await connectToDatabase();

  // Scoped to the caller: ids alone would let anyone mark anyone's notifications.
  await Notification.updateMany(
    { _id: { $in: ids }, userId: session.user.uid },
    { $set: { isRead: true } }
  );

  return NextResponse.json({ success: true });
}

// DELETE /api/notifications — dismiss one or all
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid = (session.user as any).uid;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const all = searchParams.get('all');

  await connectToDatabase();

  if (all === 'true') {
    await Notification.deleteMany({ userId: uid });
  } else if (id) {
    await Notification.deleteOne({ _id: id, userId: uid });
  } else {
    return NextResponse.json({ error: 'Provide id or all=true' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}