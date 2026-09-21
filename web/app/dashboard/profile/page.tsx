import { ExternalLink, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/auth";
import { fmtTime } from "@/components/dashboard/labels";
import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AuditEvent, Investigation } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await shellContext();
  const u = ctx.session.user;
  const [audit, investigations] = await Promise.all([load<AuditEvent[]>(ctx, "/api/audit?limit=200", []), load<Investigation[]>(ctx, "/api/investigations?limit=100", [])]);
  const mine = audit.data.filter((e) => e.actor_type === "human" && e.actor === u.login);
  const approvals = mine.filter((e) => e.event_type === "APPROVED").length;
  const rejections = mine.filter((e) => e.event_type === "REJECTED").length;
  const scans = mine.filter((e) => e.event_type === "SCAN_STARTED").length;

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Profile" description="Your account, your workspace, and what you have decided." />
      <section className="flex items-center gap-4">
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
      <Separator />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Workspace</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
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
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/connect" />}>
          Change repository
        </Button>
      </section>
      <Separator />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Your activity</h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Approvals</dt>
            <dd className="font-medium tabular-nums">{approvals}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Rejections</dt>
            <dd className="font-medium tabular-nums">{rejections}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Scans started</dt>
            <dd className="font-medium tabular-nums">{scans}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Investigations</dt>
            <dd className="font-medium tabular-nums">{investigations.data.filter((i) => i.actor === u.login).length}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">Every approval and rejection is recorded in the audit log under your GitHub login.</p>
      </section>
      <Separator />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Session</h2>
        <p className="text-xs text-muted-foreground">Your GitHub token lives only in the encrypted session cookie and is used server-side to read the policy repository and open issues you approve.</p>
        <form action={doSignOut}>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </section>
    </div>
  );
}
