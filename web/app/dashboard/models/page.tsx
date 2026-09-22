import type { Metadata } from "next";
import { ModelsView } from "@/components/dashboard/models-view";
import { UsageView } from "@/components/dashboard/usage-view";
import { PageHeader } from "@/components/dashboard/page-header";
import { SystemPanel } from "@/components/dashboard/system-panel";
import { load, shellContext } from "@/lib/dashboard-data";
import type { EvalReport, SystemStatus, Usage } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Models" };

export default async function ModelsPage() {
  const ctx = await shellContext();
  const [evals, usage, sys] = await Promise.all([load<EvalReport | null>(ctx, "/api/evals/latest", null), load<Usage | null>(ctx, "/api/usage?period=today", null), load<SystemStatus | null>(ctx, "/api/system", null)]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="System" title="Models" description="What is actually running — Microsoft Foundry, Azure AI Search, embeddings, the SEBI connector, Jev — with the telemetry each has produced." />
      <SystemPanel sys={sys.data} />
      <UsageView usage={usage.data} />
      <ModelsView health={ctx.health} evals={evals.data} />
    </div>
  );
}
