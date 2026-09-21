import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { BackendError, backendConfigured, backendFetch } from "@/lib/backend";
import type { Health } from "@/lib/pipeline-types";
import { ACTIVE_TENANT_COOKIE, tenantStore, type Tenant } from "@/lib/tenant-store";

/** Server-side context every dashboard route needs: session, tenant, backend health. Redirects when missing. */
export type ShellContext = { session: Session; tenant: Tenant; tenants: Tenant[]; health: Health | null; backendError: string | null };

/** The user's companies plus the one the `ac-tenant` cookie selects (newest when unset or stale). */
export async function activeTenant(githubId: string): Promise<{ tenants: Tenant[]; tenant: Tenant | null }> {
  const tenants = await tenantStore().listByOwner(githubId);
  const wanted = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  return { tenants, tenant: tenants.find((t) => t.tenantId === wanted) ?? tenants[0] ?? null };
}

export async function shellContext(): Promise<ShellContext> {
  const session = await auth();
  if (!session) redirect("/signin");
  const { tenants, tenant } = await activeTenant(session.user.githubId);
  if (!tenant) redirect("/connect");
  let health: Health | null = null;
  let backendError: string | null = null;
  if (!backendConfigured()) {
    backendError = "Backend not configured. Set BACKEND_URL and BACKEND_API_KEY in web/.env.local and start the FastAPI service.";
  } else {
    try {
      const res = await fetch(`${process.env.BACKEND_URL!.replace(/\/$/, "")}/health`, { cache: "no-store" });
      health = (await res.json()) as Health;
    } catch {
      backendError = `Backend unreachable at ${process.env.BACKEND_URL}`;
    }
  }
  return { session, tenant, tenants, health, backendError };
}

/** Fetch one backend resource for a page; returns `fallback` (and the error) instead of throwing so pages render an Alert. */
export async function load<T>(ctx: ShellContext, path: string, fallback: T): Promise<{ data: T; error: string | null }> {
  if (ctx.backendError) return { data: fallback, error: ctx.backendError };
  try {
    return { data: await backendFetch<T>(path, { tenant: ctx.tenant, session: ctx.session }), error: null };
  } catch (e) {
    return { data: fallback, error: e instanceof BackendError ? e.message : "Backend error" };
  }
}
