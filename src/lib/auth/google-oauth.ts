export function getGoogleAuthUrl(nonce: string, callbackUrl: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';

  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
    redirect_uri: `${appUrl}/api/auth/callback/google`,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'consent',
    access_type: 'offline',
    nonce,
    state: callbackUrl,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}