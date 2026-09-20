import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import type { JWT } from "next-auth/jwt";

/**
 * Auth.js v5. GitHub is the identity provider AND the source of company policy
 * documents, so the OAuth token is kept in the (encrypted) JWT and read server-side
 * only via `auth()`. Never render session.accessToken in a client component.
 *
 * Works with "Expire user access tokens" enabled on the OAuth App: tokens are
 * refreshed transparently when they expire (GitHub: 8h access / 6mo refresh).
 *
 * Required env: AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET.
 * Behind Azure App Service / Container Apps also set AUTH_TRUST_HOST=true.
 */

async function refreshGitHubToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) return { ...token, error: "RefreshTokenMissing" };
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.AUTH_GITHUB_ID,
      client_secret: process.env.AUTH_GITHUB_SECRET,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) return { ...token, error: "RefreshTokenError" };
  return {
    ...token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token.refreshToken,
    expiresAt: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
    error: undefined,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      // `repo` is needed to read private policy repositories. Swap for a GitHub App
      // installation (per-repo permissions) when moving past MVP — see README.
      authorization: { params: { scope: "read:user user:email repo" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at, // undefined when token expiry is disabled on the OAuth App
          login: String(profile.login ?? ""),
          githubId: String(profile.id ?? ""),
        };
      }
      // refresh 60s before expiry
      if (token.expiresAt && Date.now() / 1000 > token.expiresAt - 60) return refreshGitHubToken(token);
      return token;
    },
    session({ session, token }) {
      session.user.login = String(token.login ?? "");
      session.user.githubId = String(token.githubId ?? "");
      session.accessToken = token.error ? undefined : typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.error = token.error;
      return session;
    },
  },
});
