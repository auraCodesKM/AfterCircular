import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenMissing" | "RefreshTokenError" | "RefreshTokenNetwork";
    user: DefaultSession["user"] & { login: string; githubId: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    refreshFailedAt?: number;
    error?: "RefreshTokenMissing" | "RefreshTokenError" | "RefreshTokenNetwork";
    login: string;
    githubId: string;
  }
}
