import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  image: string;
  sub: string;
  stellarPublicKey?: string;
}

// The raw Google ID token is deliberately absent. It used to be embedded here
// and handed back to the browser by GET /api/auth/session, which defeated the
// point of the httpOnly session cookie: any XSS could lift a live Google
// credential. Nothing in the app consumes it.

export interface AppSession {
  user: SessionUser;
}

const getSecret = () => {
  // NEXTAUTH_SECRET is accepted as a fallback so existing deployments keep
  // working; NextAuth itself is gone. Prefer SESSION_SECRET going forward.
  const secret = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Refusing to sign or verify sessions.");
  }
  return new TextEncoder().encode(secret);
};

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(await getSecret());
}

export async function verifySessionToken(token: string): Promise<AppSession | null> {
  try {
    const { payload } = await jwtVerify(token, await getSecret());
    return {
      user: {
        uid: payload.uid as string,
        email: payload.email as string,
        name: payload.name as string,
        image: payload.image as string,
        sub: payload.sub as string,
      },
    };
  } catch {
    return null;
  }
}

// ── New helper for use in API routes ─────────────────────────────────────────
export async function getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('app-session')?.value; // ← 'app-session' not 'session'
  if (!token) return null;
  return verifySessionToken(token);
}