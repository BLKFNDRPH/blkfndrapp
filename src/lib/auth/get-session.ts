// Use this in server components and API routes instead of getServerSession()
import { cookies } from 'next/headers';
import { verifySessionToken, AppSession } from './session';

export async function getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('app-session')?.value;
  if (!token) return null;
  return verifySessionToken(token);
}