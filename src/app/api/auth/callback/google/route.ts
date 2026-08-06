import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';
import { createSessionToken } from '@/lib/auth/session';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import { LOGIN_STATE_COOKIE, type LoginState } from '@/lib/auth/login-state';

/** Constant-time string compare that tolerates unequal lengths. */
function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function fail(reason: string, baseUrl: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${reason}`, baseUrl), { status: 303 });
  response.cookies.delete(LOGIN_STATE_COOKIE);
  return response;
}

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  // ── Recover the login attempt we started ────────────────────────────────
  const rawLoginState = req.cookies.get(LOGIN_STATE_COOKIE)?.value;
  if (!rawLoginState) {
    console.error('[Auth] Callback with no login-state cookie — rejecting');
    return fail('NoLoginState', baseUrl);
  }

  let loginState: Partial<LoginState>;
  try {
    loginState = JSON.parse(rawLoginState);
  } catch {
    return fail('BadLoginState', baseUrl);
  }

  if (!loginState.nonce || !loginState.state) {
    return fail('BadLoginState', baseUrl);
  }

  let idToken: string | null = null;
  let returnedState: string | null = null;

  try {
    const formData = await req.formData();
    idToken = formData.get('id_token') as string | null;
    returnedState = formData.get('state') as string | null;
  } catch (err) {
    console.error('[Auth] Error parsing form data:', err);
    return fail('FormParseError', baseUrl);
  }

  if (!idToken) {
    return fail('NoIdToken', baseUrl);
  }

  // ── CSRF: the state Google echoes back must be the one we issued ────────
  if (!returnedState || !secureEquals(returnedState, loginState.state)) {
    console.error('[Auth] OAuth state mismatch — rejecting');
    return fail('StateMismatch', baseUrl);
  }

  try {
    const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

    // Verify token signature, audience, and issuer
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: 'https://accounts.google.com',
      audience: clientId,
    });

    // ── Token binding: this token must be the one minted for *this* attempt.
    // Without it, a validly-signed token for the attacker's own account can be
    // replayed into a victim's browser to log them into the attacker's account.
    const tokenNonce = payload.nonce as string | undefined;
    if (!tokenNonce || !secureEquals(tokenNonce, loginState.nonce)) {
      console.error('[Auth] ID token nonce mismatch — rejecting');
      return fail('NonceMismatch', baseUrl);
    }

    const uid = payload.sub;
    if (!uid) {
      console.error('[Auth] sub claim is missing in token payload');
      return fail('InvalidTokenPayload', baseUrl);
    }

    if (payload.email && payload.email_verified === false) {
      console.error('[Auth] Unverified Google email — rejecting');
      return fail('EmailUnverified', baseUrl);
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
    });

    const safeCallbackUrl = safeInternalPath(loginState.returnTo);
    const response = NextResponse.redirect(new URL(safeCallbackUrl, baseUrl), { status: 303 });
    response.cookies.set('app-session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
      secure: process.env.NODE_ENV === 'production',
    });
    // Single-use: burn the login state so the same nonce cannot be replayed.
    response.cookies.delete(LOGIN_STATE_COOKIE);

    return response;
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error);
    return fail('TokenExchange', baseUrl);
  }
}
