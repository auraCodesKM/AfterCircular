"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { BackendError, backendFetch } from "@/lib/backend";
import { tenantStore } from "@/lib/tenant-store";

export type DemoStatus = {
  tenant_id: string;
  company_name: string;
  demo: boolean;
  reset_available: boolean;
  scan_running: boolean;
  will_reset: Record<string, number>;
  live_documents: number;
  github_issues_kept: string[];
  preserved: string[];
};
export type DemoResetResult = { tenant: string; company_name: string; reset_completed: boolean; records_reset: Record<string, number>; preserved: string[]; github_issues_kept: string[]; timestamp: string };
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Only workspaces the signed-in person connected; the tenant id from the browser is never trusted on its own. */
async function call<T>(tenantId: string, path: string, body?: unknown): Promise<Result<T>> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  const tenant = (await tenantStore().listByOwner(session.user.githubId)).find((t) => t.tenantId === tenantId);
  if (!tenant) return { ok: false, error: "That workspace is not yours" };
  try {
    return { ok: true, data: await backendFetch<T>(path, { tenant, session, method: body === undefined ? "GET" : "POST", body }) };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.message : "Backend error" };
  }
}

export async function demoStatus(tenantId: string) {
  return call<DemoStatus>(tenantId, "/api/workspace/demo");
}

export async function setDemoMode(tenantId: string, enabled: boolean) {
  return call<DemoStatus>(tenantId, "/api/workspace/demo/mode", { enabled });
}

export async function resetDemo(tenantId: string) {
  const r = await call<DemoResetResult>(tenantId, "/api/workspace/demo/reset", { confirm_tenant_id: tenantId });
  if (r.ok) revalidatePath("/dashboard", "layout");
  return r;
}
