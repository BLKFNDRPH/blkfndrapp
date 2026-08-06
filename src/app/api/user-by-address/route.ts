import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import UserModel from '@/lib/models/User';
import { getSession } from '@/lib/auth/session';

// Maps a Stellar address to a platform identity. Signed-in callers only —
// anonymous access turned this into a deanonymisation oracle: take any investor
// address off the public ledger, get back the person's display name.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  const field = searchParams.get('field') || 'stellarPublicKey';

  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  try {
    await connectToDatabase();

    const user = field === 'uid'
      ? await UserModel.findOne({ uid: address }).lean()
      : await UserModel.findOne({ stellarPublicKey: address }).lean();

    if (!user) return NextResponse.json(null);

    // `role` is deliberately omitted: callers only need an identity to address
    // notifications to, and publishing who the admins are invites targeting.
    return NextResponse.json({
      uid: user.uid,
      name: user.name,
      creatorAvatar: user.creatorAvatar,
      wallet: user.wallet,
      stellarPublicKey: user.stellarPublicKey,
    });
  } catch (error) {
    console.error('Error fetching user by address:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
