/**
 * Auth.js must run here, not only in Server Components: GitHub refresh tokens are single-use, and a refresh performed
 * inside `auth()` in a Server Component cannot write the new token back to the session cookie (set-cookie is dropped
 * there). The next request would then retry the already-consumed refresh token → RefreshTokenError → "SessionExpired".
 * Running `auth` as the proxy persists the rotated token on every dashboard request.
 */
export { auth as proxy } from "@/auth";

export const config = { matcher: ["/dashboard/:path*"] };
