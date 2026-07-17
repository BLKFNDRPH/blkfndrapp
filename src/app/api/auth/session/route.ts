import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('app-session')?.value;
  if (!token) return NextResponse.json({}); // NextAuth expects {} not null

  const session = await verifySessionToken(token);
  if (!session?.user) return NextResponse.json({});

  try {
    await connectToDatabase();
    const dbUser = await User.findOne({ uid: session.user.uid }).lean();
    if (dbUser && dbUser.wallet === 'connected' && dbUser.stellarPublicKey) {
      session.user.stellarPublicKey = dbUser.stellarPublicKey;
    }
  } catch (err) {
    console.error('Session API route DB lookup error:', err);
  }

  return NextResponse.json(session);
}