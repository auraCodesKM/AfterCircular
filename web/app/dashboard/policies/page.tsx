import type { Metadata } from "next";
import { Suspense } from "react";
import { fmtTime } from "@/components/dashboard/labels";
import { PageHeader } from "@/components/dashboard/page-header";
import { PoliciesView } from "@/components/dashboard/policies-view";
import { load, shellContext } from "@/lib/dashboard-data";
import type { PolicyIndex } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Policies" };

export default async function PoliciesPage() {
  const ctx = await shellContext();
  const { data } = await load<PolicyIndex>(ctx, "/api/policies", { index: null, documents: [] });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${ctx.tenant.companyName} · Policies`}
        title="Internal policies"
        description="The corpus retrieval searches — read from the connected repository's default branch and chunked by section."
        meta={
          data.index ? (
            <>
              <span className="font-mono">
                {data.index.repo}@{data.index.commit_sha.slice(0, 7)}
              </span>
              <span>{data.index.chunk_count} chunks</span>
              <span>indexed {fmtTime(data.index.indexed_at)}</span>
            </>
          ) : undefined
        }
      />
      <Suspense>
        <PoliciesView documents={data.documents} repo={ctx.tenant.githubRepo} branch={ctx.tenant.defaultBranch} />
      </Suspense>
    </div>
  );
}
