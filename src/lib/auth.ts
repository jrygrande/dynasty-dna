import { type NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";

// Validate required environment variables
if (!process.env.NEXTAUTH_SECRET) {
  console.error("Missing NEXTAUTH_SECRET environment variable");
}
if (!process.env.NEXTAUTH_URL) {
  console.error("Missing NEXTAUTH_URL environment variable");
}

// Build providers array
const providers = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
} else {
  console.warn("Google OAuth not configured - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  );
} else {
  console.warn("GitHub OAuth not configured - missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET");
}

if (providers.length === 0) {
  console.error("No OAuth providers configured! Users will not be able to sign in.");
}

/**
 * Lazy adapter: defers `DrizzleAdapter(getDb(), ...)` until next-auth invokes
 * its first method (sign-in, link account, etc.). Without this, the adapter —
 * and therefore `getDb()` — runs at module-load time, which means:
 *   - any cold start that imports this module pays the DB-init cost even when
 *     the request never touches auth, and
 *   - the production build fails outright if `DATABASE_URL` isn't visible to
 *     Next.js during static analysis (collect page data).
 */
function createLazyAdapter(): Adapter {
  let real: Adapter | null = null;
  const resolve = (): Adapter => {
    if (!real) {
      real = DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      }) as Adapter;
    }
    return real;
  };
  return new Proxy({} as Adapter, {
    get(_target, prop) {
      const target = resolve() as unknown as Record<string | symbol, unknown>;
      const value = target[prop];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export const authOptions: NextAuthOptions = {
  adapter: createLazyAdapter(),
  providers,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  debug: process.env.NODE_ENV === "development",
};
