import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Logo } from "@/components/brand/aftercircular-logo";
import { Dashboard } from "@/components/dashboard/dashboard";
import { FilterDefs } from "@/components/landing/hero-art";
import { BackendError, backendConfigured, backendFetch } from "@/lib/backend";
import type { AuditEvent, DashboardSnapshot, EvalReport, Health, ProcessedDocument, ReviewRecord, ScanRecord } from "@/lib/pipeline-types";
import { tenantStore } from "@/lib/tenant-store";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/signin");
  const tenant = await tenantStore().getByOwner(session.user.githubId);
  if (!tenant) redirect("/connect");

  const snapshot: DashboardSnapshot = { health: null, scan: null, documents: [], reviews: [], audit: [], evals: null, backendError: null };
  if (!backendConfigured()) {
    snapshot.backendError = "Backend not configured. Set BACKEND_URL and BACKEND_API_KEY in web/.env.local and start the FastAPI service.";
  } else {
    const ctx = { tenant, session };
    try {
      const base = process.env.BACKEND_URL!.replace(/\/$/, "");
      const [health, scan, documents, reviews, audit, evals] = await Promise.all([
        fetch(`${base}/health`, { cache: "no-store" }).then((r) => r.json() as Promise<Health>),
        backendFetch<ScanRecord | null>("/api/scans/latest", ctx),
        backendFetch<ProcessedDocument[]>("/api/documents", ctx),
        backendFetch<ReviewRecord[]>("/api/reviews", ctx),
        backendFetch<AuditEvent[]>("/api/audit?limit=40", ctx),
        backendFetch<EvalReport>("/api/evals/latest", ctx),
      ]);
      Object.assign(snapshot, { health, scan, documents, reviews, audit, evals });
    } catch (e) {
      snapshot.backendError = e instanceof BackendError ? e.message : "Backend unreachable";
    }
  }

  return (
    <div className="min-h-dvh">
      <FilterDefs />
      <header className="container-x flex h-16 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-5 text-sm">
          <Link href="/connect" className="text-muted hover:text-ink">
            Change repository
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="text-muted hover:text-ink">
              Sign out (@{session.user.login})
            </button>
          </form>
        </div>
      </header>
      <main className="container-x py-8 md:py-12">
        <Dashboard tenant={{ companyName: tenant.companyName, githubRepo: tenant.githubRepo, defaultBranch: tenant.defaultBranch }} initial={snapshot} />
      </main>
    </div>
  );
}
