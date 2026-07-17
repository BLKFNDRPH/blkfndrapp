// app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import { buildAuthOptions } from '@/lib/authOptions';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

async function handler(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const { searchParams } = new URL(req.url);
  const params = await context.params;
  const segments = params.nextauth ?? [];

  const isSignin = segments.includes('signin');
  const isCallback = segments.includes('callback');

  let nonce: string | undefined;

  if (isSignin) {
    nonce = searchParams.get('nonce') ?? undefined;
  } else if (isCallback) {
    const cookieStore = await cookies();
    nonce = cookieStore.get('zklogin-nonce')?.value ?? undefined;
  }

  const authOptions = buildAuthOptions(nonce);
  const nextAuthHandler = NextAuth(authOptions);
  const response = await nextAuthHandler(req, context as any);

  // After signin initiation, persist the nonce in a cookie so the
  // callback step can reconstruct the same authOptions with the same nonce
  if (isSignin && nonce) {
    const res = new NextResponse(response.body, response);
    res.cookies.set('zklogin-nonce', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10, // 10 minutes
    });
    return res;
  }

  return response;
}

export { handler as GET, handler as POST };