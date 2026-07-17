import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';
import { getSession } from '@/lib/auth/session';
import { checkIsAdminOnChain } from "@/lib/stellar";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const { uid } = await params;
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.uid !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectToDatabase();
    let user = await User.findOne({ uid }).lean();
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Sync user role with on-chain admin status
    if (user.stellarPublicKey) {
      const isOnChain = await checkIsAdminOnChain(user.stellarPublicKey);
      const expectedRole = isOnChain ? "admin" : "user";
      if (user.role !== expectedRole) {
        const updated = await User.findOneAndUpdate(
          { uid },
          { $set: { role: expectedRole } },
          { new: true, lean: true }
        );
        if (updated) {
          user = updated;
          console.log(`[GET /api/user/${uid}] User role synced to ${expectedRole} in DB based on linked wallet ${user.stellarPublicKey}`);
        }
      }
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('GET /api/user/[uid] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const { uid } = await params;
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.uid !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { name, creatorAvatar } = await req.json();
    const updatePayload: Record<string, any> = {};
    if (name !== undefined) updatePayload.name = name;
    if (creatorAvatar !== undefined) updatePayload.creatorAvatar = creatorAvatar;

    await connectToDatabase();

    const updated = await User.findOneAndUpdate(
      { uid },
      { $set: updatePayload },
      { new: true, lean: true }
    );

    if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/user/[uid] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}