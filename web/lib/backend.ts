import "server-only";
import type { Session } from "next-auth";
import type { Tenant } from "@/lib/tenant-store";

/** Server-side client for the FastAPI backend. The API key and the user's GitHub token never reach the browser. */

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function backendConfigured() {
  return Boolean(process.env.BACKEND_URL && process.env.BACKEND_API_KEY);
}

export async function backendFetch<T>(
  path: string,
  { tenant, session, method = "GET", body }: { tenant: Tenant; session: Session; method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const base = process.env.BACKEND_URL?.replace(/\/$/, "");
  const key = process.env.BACKEND_API_KEY;
  if (!base || !key) throw new BackendError(503, "Backend not configured (BACKEND_URL / BACKEND_API_KEY)");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Tenant-Id": tenant.tenantId,
    "X-Tenant-Company": tenant.companyName,
    "X-Tenant-Repo": tenant.githubRepo,
    "X-Tenant-Branch": tenant.defaultBranch,
    "X-Actor": session.user.login || session.user.githubId,
    "X-Actor-Id": session.user.githubId, // the backend re-checks workspace ownership against it (demo controls)
  };
  if (session.accessToken) headers["X-GitHub-Token"] = session.accessToken;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new BackendError(503, `Backend unreachable at ${base}`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {}
    throw new BackendError(res.status, detail);
  }
  return (await res.json()) as T;
}
