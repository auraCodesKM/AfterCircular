import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Logo } from "@/components/brand/aftercircular-logo";
import { Glass } from "@/components/ui/glass";
import { FilterDefs } from "@/components/landing/hero-art";
import { RepoPicker } from "@/components/connect/repo-picker";
import { listRepos } from "@/lib/github";
import { tenantStore } from "@/lib/tenant-store";

export const metadata: Metadata = { title: "Connect a repository" };

export default async function ConnectPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/signin");

  const [repos, existing] = await Promise.all([listRepos(session.accessToken), tenantStore().listByOwner(session.user.githubId)]);

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
          <button type="submit" className="text-sm text-ink-3 hover:text-ink">
            Sign out {session.user.login ? `(@${session.user.login})` : ""}
          </button>
        </form>
      </header>

      <main className="container-x grid gap-6 py-10 md:grid-cols-12 md:py-16">
        <div className="md:col-span-5">
          <p className="eyebrow">Step 2 of 2</p>
          <h1 className="display mt-4 text-4xl md:text-5xl">Choose the repository that holds your policies.</h1>
          <p className="mt-5 max-w-md text-ink-2">
            AfterCircular watches this repository&rsquo;s default branch. When a regulator publishes something that conflicts with a policy
            here, it drafts the fix and opens an issue for review.
          </p>
          {existing.length ? (
            <Glass tone="ink" className="mt-8" bodyClassName="p-5">
              <p className="eyebrow text-white/55">Connected companies</p>
              <ul className="mt-2 space-y-2">
                {existing.map((t) => (
                  <li key={t.tenantId}>
                    <p className="font-medium">{t.companyName}</p>
                    <p className="font-mono text-sm text-white/70">{t.githubRepo}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-white/50">
                Each company is an isolated tenant. Adding another keeps these; using the same company name re-points its repository.
              </p>
            </Glass>
          ) : null}
        </div>
        <div className="min-w-0 md:col-span-7">
          <Glass tone="paper" bodyClassName="p-6 md:p-8">
            <RepoPicker repos={repos} />
          </Glass>
        </div>
      </main>
    </div>
  );
}
