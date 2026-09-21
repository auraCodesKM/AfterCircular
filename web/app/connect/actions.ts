"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRepo, hasManifest } from "@/lib/github";
import { tenantStore, type Tenant } from "@/lib/tenant-store";

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
  redirect("/dashboard");
}
