import NextAuth from 'next-auth';
import type { NextAuthOptions } from 'next-auth';

const authOptions: NextAuthOptions = {
  providers: [
    {
      id: 'webex',
      name: 'Webex',
      type: 'oauth',
      authorization: {
        url: 'https://webexapis.com/v1/authorize',
        params: {
          scope: 'spark:all',
          response_type: 'code',
        },
      },
      token: 'https://webexapis.com/v1/access_token',
      userinfo: 'https://webexapis.com/v1/people/me',
      clientId: process.env.WEBEX_CLIENT_ID,
      clientSecret: process.env.WEBEX_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.id,
          name: profile.displayName,
          email: profile.emails?.[0] || '',
          image: profile.avatar,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
