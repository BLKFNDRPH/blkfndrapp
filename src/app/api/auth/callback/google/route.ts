import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';
import { createSessionToken } from '@/lib/auth/session';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';

  let idToken: string | null = null;
  let callbackUrl = '/profile';

  try {
    const formData = await req.formData();
    idToken = formData.get('id_token') as string | null;
    callbackUrl = (formData.get('state') as string | null) || '/profile';
  } catch (err) {
    console.error('[Auth] Error parsing form data:', err);
    return NextResponse.redirect(new URL('/login?error=FormParseError', baseUrl), { status: 303 });
  }

  if (!idToken) {
    return NextResponse.redirect(new URL('/login?error=NoIdToken', baseUrl), { status: 303 });
  }

  try {
    const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

    // Verify token signature, audience, and issuer
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: 'https://accounts.google.com',
      audience: clientId,
    });

    const uid = payload.sub;
    if (!uid) {
      console.error('[Auth] sub claim is missing in token payload');
      return NextResponse.redirect(new URL('/login?error=InvalidTokenPayload', baseUrl), { status: 303 });
    }
    const email = (payload.email as string) ?? '';
    const name = (payload.name as string) ?? 'Anonymous';
    const image = (payload.picture as string) ?? `https://i.pravatar.cc/150?u=${uid}`;

    await connectToDatabase();
    await User.findOneAndUpdate(
      { uid },
      {
        $setOnInsert: {
          uid,
          email,
          name,
          creatorAvatar: image,
          role: 'user',
          wallet: 'disconnected',
          stellarPublicKey: '',
        },
        $set: { lastLogin: new Date().toISOString() },
      },
      { upsert: true, new: true }
    );

    const sessionToken = await createSessionToken({
      uid,
      email,
      name,
      image,
      sub: uid,
      idToken,
    });

    const safeCallbackUrl = callbackUrl.startsWith('/') ? callbackUrl : '/profile';
    const response = NextResponse.redirect(new URL(safeCallbackUrl, baseUrl), { status: 303 });
    response.cookies.set('app-session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error);
    return NextResponse.redirect(new URL('/login?error=TokenExchange', baseUrl), { status: 303 });
  }
}