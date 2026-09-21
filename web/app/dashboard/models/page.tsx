import type { Metadata } from "next";
import { ModelsView } from "@/components/dashboard/models-view";
import { UsageView } from "@/components/dashboard/usage-view";
import { PageHeader } from "@/components/dashboard/page-header";
import { load, shellContext } from "@/lib/dashboard-data";
import type { EvalReport, Usage } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Models" };

export default async function ModelsPage() {
  const ctx = await shellContext();
  const [evals, usage] = await Promise.all([load<EvalReport | null>(ctx, "/api/evals/latest", null), load<Usage | null>(ctx, "/api/usage?period=today", null)]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="System" title="Models" description="Which model handles which task, what it has cost today, and how each has measured on AfterCircular's golden scenarios." />
      <UsageView usage={usage.data} />
      <ModelsView health={ctx.health} evals={evals.data} />
    </div>
  );
}
