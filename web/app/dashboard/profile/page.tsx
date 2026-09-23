import { Building2, ExternalLink, FlaskConical, GitBranch, History, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/auth";
import { DemoControls } from "@/components/dashboard/demo-controls";
import { fmtTime } from "@/components/dashboard/labels";
import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Stat, StatGrid } from "@/components/dashboard/stat";
import { backendFetch } from "@/lib/backend";
import { load, shellContext } from "@/lib/dashboard-data";
import type { DemoStatus } from "./demo-actions";
import type { AuditEvent, Investigation } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await shellContext();
  const u = ctx.session.user;
  const [audit, investigations] = await Promise.all([load<AuditEvent[]>(ctx, "/api/audit?limit=200", []), load<Investigation[]>(ctx, "/api/investigations?limit=100", [])]);
  // only this person's own workspaces; a backend without demo controls simply hides the section
  const demo = (await Promise.all(ctx.tenants.map((t) => backendFetch<DemoStatus>("/api/workspace/demo", { tenant: t, session: ctx.session }).catch(() => null)))).filter((s): s is DemoStatus => !!s);
  const mine = audit.data.filter((e) => e.actor_type === "human" && e.actor === u.login);
  const approvals = mine.filter((e) => e.event_type === "APPROVED").length;
  const rejections = mine.filter((e) => e.event_type === "REJECTED").length;
  const scans = mine.filter((e) => e.event_type === "SCAN_STARTED").length;

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader eyebrow="Account" title="Profile" description="Your account, your workspace, and what you have decided." />
      <section className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <Avatar size="lg">
          {u.image ? <AvatarImage src={u.image} alt="" /> : null}
          <AvatarFallback>{(u.name || u.login).slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-base font-medium">{u.name || `@${u.login}`}</p>
          <p className="text-sm text-muted-foreground">
            @{u.login}
            {u.email ? ` · ${u.email}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary">GitHub connected</Badge>
            <Badge variant="outline">id {u.githubId}</Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" nativeButton={false} render={<a href={`https://github.com/${u.login}`} target="_blank" rel="noreferrer" />}>
          GitHub <ExternalLink />
        </Button>
      </section>
      <section className="space-y-3">
        <SectionHeader
          icon={<Building2 />}
          title="Workspace"
          action={
            <Button variant="outline" size="xs" nativeButton={false} render={<Link href="/connect" />}>
              Add company
            </Button>
          }
        />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm">
          <dt className="text-muted-foreground">Company</dt>
          <dd>{ctx.tenant.companyName}</dd>
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="flex items-center gap-1 font-mono text-xs">
            <GitBranch aria-hidden className="size-3" />
            {ctx.tenant.githubRepo} · {ctx.tenant.defaultBranch}
          </dd>
          <dt className="text-muted-foreground">Connected</dt>
          <dd>
            {fmtTime(ctx.tenant.connectedAt)} by @{ctx.tenant.connectedByLogin}
          </dd>
          <dt className="text-muted-foreground">Tenant</dt>
          <dd className="font-mono text-xs">{ctx.tenant.tenantId}</dd>
        </dl>
      </section>
      <section className="space-y-3">
        <SectionHeader icon={<History />} title="Your activity" description="Every approval and rejection is recorded in the audit log under your GitHub login." />
        <StatGrid>
          <Stat label="Approvals" value={approvals} tone={approvals ? "success" : "default"} />
          <Stat label="Rejections" value={rejections} />
          <Stat label="Scans started" value={scans} />
          <Stat label="Investigations" value={investigations.data.filter((i) => i.actor === u.login).length} />
        </StatGrid>
      </section>
      {demo.length ? (
        <section className="space-y-3">
          <SectionHeader icon={<FlaskConical />} title="Demo controls" description="Reset a demo workspace to the demo baseline. Live workspaces are never reset." />
          <DemoControls initial={demo} />
        </section>
      ) : null}
      <section className="space-y-3">
        <SectionHeader icon={<KeyRound />} title="Session" />
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs leading-5 text-muted-foreground">Your GitHub token lives only in the encrypted session cookie and is used server-side to read the policy repository and open issues you approve.</p>
          <form action={doSignOut}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
