import type { Metadata } from "next";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PageHeader } from "@/components/dashboard/page-header";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AuditEvent } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const ctx = await shellContext();
  const audit = await load<AuditEvent[]>(ctx, "/api/audit?limit=200", []);
  return (
    <div className="space-y-6">
      <PageHeader title="Activity" description="The audit log: every scan, detection, judgment, human decision and action, in order." meta={<span>{audit.data.length} events</span>} />
      <div className="rounded-md border border-border px-3">
        <ActivityFeed events={audit.data} />
      </div>
    </div>
  );
}
