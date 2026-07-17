import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import UserModel from '@/lib/models/User';

export async function GET(req: NextRequest) {
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

    return NextResponse.json({
      uid: user.uid,
      name: user.name,
      creatorAvatar: user.creatorAvatar,
      role: user.role,
      wallet: user.wallet,
      stellarPublicKey: user.stellarPublicKey,
    });
  } catch (error) {
    console.error('Error fetching user by address:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}