"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRepo, hasManifest } from "@/lib/github";
import { ACTIVE_TENANT_COOKIE, tenantStore, type Tenant } from "@/lib/tenant-store";

export type ConnectState = { error?: string };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export async function connectRepo(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const session = await auth();
  if (!session?.accessToken) redirect("/signin");

  const companyName = String(formData.get("company") ?? "").trim();
  const fullName = String(formData.get("repo") ?? "").trim();
  if (companyName.length < 2) return { error: "Enter your company name." };
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { error: "Choose a repository." };

  let repo;
  try {
    repo = await getRepo(session.accessToken, fullName); // re-verify access server-side; never trust the form
  } catch {
    return { error: "That repository isn't readable with your GitHub account." };
  }

  if (!(await hasManifest(session.accessToken, repo.fullName, repo.defaultBranch))) {
    return { error: `${repo.fullName} has no aftercircular.yml on ${repo.defaultBranch}. AfterCircular only indexes repositories that carry the manifest — for the demo, choose acme-securities-policies.` };
  }

  const tenant: Tenant = {
    tenantId: `${slug(companyName)}-${session.user.githubId}`,
    companyName,
    githubRepo: repo.fullName,
    defaultBranch: repo.defaultBranch,
    connectedBy: session.user.githubId,
    connectedByLogin: session.user.login,
    connectedAt: new Date().toISOString(),
  };
  await tenantStore().upsert(tenant);
  await setActiveTenantCookie(tenant.tenantId);
  redirect("/dashboard");
}

async function setActiveTenantCookie(tenantId: string) {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** Switch the active company. Only tenants this user connected are selectable; everything else stays partitioned by tenant_id. */
export async function switchTenant(tenantId: string) {
  const session = await auth();
  if (!session) redirect("/signin");
  const mine = await tenantStore().listByOwner(session.user.githubId);
  if (!mine.some((t) => t.tenantId === tenantId)) return;
  await setActiveTenantCookie(tenantId);
  redirect("/dashboard");
}
