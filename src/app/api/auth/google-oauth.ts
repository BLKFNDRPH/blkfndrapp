// lib/auth/google-oauth.ts

export function getGoogleAuthUrl(nonce: string, callbackUrl: string): string {
  if (!nonce) throw new Error('nonce is required for zkLogin — cannot build OAuth URL');
  
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/google`,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'consent',
    access_type: 'online',  // ← change offline to online (zkLogin doesn't need refresh tokens)
    nonce,
    state: callbackUrl,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}