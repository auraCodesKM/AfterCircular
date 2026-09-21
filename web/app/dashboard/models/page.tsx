import type { Metadata } from "next";
import { ModelsView } from "@/components/dashboard/models-view";
import { PageHeader } from "@/components/dashboard/page-header";
import { load, shellContext } from "@/lib/dashboard-data";
import type { EvalReport } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Models" };

export default async function ModelsPage() {
  const ctx = await shellContext();
  const evals = await load<EvalReport | null>(ctx, "/api/evals/latest", null);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="System" title="Models" description="Which model handles which task, and how each has measured on AfterCircular's golden scenarios. No number here is estimated." />
      <ModelsView health={ctx.health} evals={evals.data} />
    </div>
  );
}
