import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Logo } from "@/components/brand/aftercircular-logo";
import { Glass } from "@/components/ui/glass";
import { FilterDefs } from "@/components/landing/hero-art";
import { tenantStore } from "@/lib/tenant-store";

export const metadata: Metadata = { title: "Dashboard" };

/** Placeholder until the pipeline dashboard (PRD §4, §17) lands. Proves auth + tenant binding end to end. */
export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/signin");
  const tenant = await tenantStore().getByOwner(session.user.githubId);
  if (!tenant) redirect("/connect");

  return (
    <div className="min-h-dvh">
      <FilterDefs />
      <header className="container-x flex h-16 items-center justify-between">
        <Logo />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="text-sm text-muted hover:text-ink">
            Sign out (@{session.user.login})
          </button>
        </form>
      </header>
      <main className="container-x py-10 md:py-16">
        <p className="eyebrow">Workspace</p>
        <h1 className="display mt-4 text-4xl md:text-5xl">{tenant.companyName}</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Glass tone="ink" bodyClassName="p-5">
            <p className="eyebrow text-white/55">Policy repository</p>
            <p className="mt-2 font-mono text-sm">{tenant.githubRepo}</p>
            <p className="text-xs text-white/50">branch: {tenant.defaultBranch}</p>
          </Glass>
          <Glass tone="paper" bodyClassName="p-5">
            <p className="eyebrow">Tenant</p>
            <p className="mt-2 font-mono text-sm">{tenant.tenantId}</p>
            <p className="text-xs text-muted">connected by @{tenant.connectedByLogin}</p>
          </Glass>
          <Glass tone="paper" bodyClassName="p-5">
            <p className="eyebrow">Pipeline</p>
            <p className="mt-2 text-sm text-ink-2">Backend not connected yet. Scan, state machine and audit log arrive with the FastAPI service.</p>
            <Link href="/connect" className="mt-3 inline-block text-sm underline underline-offset-4">
              Change repository
            </Link>
          </Glass>
        </div>
      </main>
    </div>
  );
}
