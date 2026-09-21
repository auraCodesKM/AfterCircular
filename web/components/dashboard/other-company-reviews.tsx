"use client";

import { ArrowRight, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Row = { tenantId: string; companyName: string; pending: number };

/** Reviews are scoped to the active company; this makes a review waiting in another workspace one click away. */
export function OtherCompanyReviews({ rows, switchTenant }: { rows: Row[]; switchTenant: (tenantId: string) => Promise<void> }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Building2 className="size-4 text-warning" />
        Waiting in another company&rsquo;s workspace
      </p>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.tenantId} className="flex items-center justify-between gap-3">
            <span>
              {r.companyName} · {r.pending} {r.pending === 1 ? "review" : "reviews"} waiting
            </span>
            <Button size="xs" variant="outline" onClick={() => switchTenant(r.tenantId)}>
              Switch <ArrowRight />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
