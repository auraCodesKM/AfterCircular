import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenMissing" | "RefreshTokenError";
    user: DefaultSession["user"] & { login: string; githubId: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: "RefreshTokenMissing" | "RefreshTokenError";
    login: string;
    githubId: string;
  }
}
