// lib/auth/session.ts

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'app-session';

export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  image: string;
  sub: string;
  idToken: string;
  stellarPublicKey?: string;
}

export interface AppSession {
  user: SessionUser;
}

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not set. Refusing to sign or verify sessions.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(getSecret());
}

export async function getSession(): Promise<AppSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecret());
    return {
      user: {
        uid: payload.uid as string,
        email: payload.email as string,
        name: payload.name as string,
        image: payload.image as string,
        sub: payload.sub as string,
        idToken: payload.idToken as string,
      },
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;