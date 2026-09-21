import type { Metadata } from "next";
import { ActivityLog } from "@/components/dashboard/activity-log";
import { PageHeader } from "@/components/dashboard/page-header";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AuditEvent } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const ctx = await shellContext();
  const audit = await load<AuditEvent[]>(ctx, "/api/audit?limit=500", []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="The audit log: every scan, detection, judgment, human decision and action, in order. Routine events (skips, retrievals) are hidden by default."
        meta={<span>{audit.data.length} events</span>}
      />
      <ActivityLog events={audit.data} />
    </div>
  );
}
