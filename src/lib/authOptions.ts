// lib/authOptions.ts
import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';

export function buildAuthOptions(nonce?: string): NextAuthOptions {
  return {
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        httpOptions: { timeout: 30000 },
        authorization: {
          params: {
            scope: 'openid email profile',
            prompt: 'consent',
            access_type: 'offline',
            ...(nonce ? { nonce } : {}),
          },
        },
      }),
    ],

    session: {
      strategy: 'jwt',
      maxAge: 24 * 60 * 60,
    },

    callbacks: {
      async signIn({ user, account }) {
        if (account?.provider !== 'google') return false;

        await connectToDatabase();

        const uid = user.id || account.providerAccountId;

        const existing = await User.findOne({ uid });

        if (!existing) {
          await User.create({
            uid,
            email: user.email || '',
            name: user.name || 'Anonymous',
            creatorAvatar:
              user.image || `https://i.pravatar.cc/150?u=${uid}`,
            role: 'user',
            wallet: 'disconnected',
            lastLogin: new Date().toISOString(),
          });
        } else {
          await User.findOneAndUpdate(
            { uid },
            { lastLogin: new Date().toISOString() }
          );
        }

        return true;
      },

      async jwt({ token, account, user, profile }) {
        if (account && user) {
          token.uid = account.providerAccountId;
          token.picture = user.image;
          token.sub = (profile as any)?.sub ?? account.providerAccountId;
          if (account.id_token) {
            token.idToken = account.id_token;
          }
        }
        return token;
      },

      async session({ session, token }) {
        if (session.user) {
          (session.user as any).uid = token.uid as string;
          session.user.image = token.picture as string;
          (session.user as any).sub = token.sub as string;
          (session.user as any).idToken = token.idToken as string | undefined;
        }
        return session;
      },
    },

    pages: {
      signIn: '/login',
    },

    secret: process.env.NEXTAUTH_SECRET,
  };
}

// Default export for getServerSession(authOptions) calls in server components/API routes
export const authOptions = buildAuthOptions();