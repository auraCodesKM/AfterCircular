import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Stat, StatGrid } from "@/components/dashboard/stat";
import { switchTenant } from "@/app/connect/actions";
import { OtherCompanyReviews } from "@/components/dashboard/other-company-reviews";
import { load, pendingByCompany, shellContext } from "@/lib/dashboard-data";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const ctx = await shellContext();
  const [documents, reviews, pendingAll] = await Promise.all([
    load<ProcessedDocument[]>(ctx, "/api/documents", []),
    load<ReviewRecord[]>(ctx, "/api/reviews", []),
    pendingByCompany(ctx),
  ]);
  const elsewhere = ctx.tenants
    .filter((t) => t.tenantId !== ctx.tenant.tenantId && (pendingAll[t.tenantId] ?? 0) > 0)
    .map((t) => ({ tenantId: t.tenantId, companyName: t.companyName, pending: pendingAll[t.tenantId] ?? 0 }));
  const byDoc = new Map(documents.data.map((d) => [d.id, d]));
  const rows = await Promise.all(
    reviews.data
      .filter((r) => byDoc.has(r.document_pk))
      .map(async (review) => {
        const doc = byDoc.get(review.document_pk)!;
        const a = doc.analysis_id ? await load<AnalysisRecord | null>(ctx, `/api/analyses/${doc.analysis_id}`, null) : { data: null };
        return { doc, review, affected: a.data?.impact?.affected_policies ?? [] };
      }),
  );
  const pending = rows.filter((r) => r.review.status === "AWAITING_REVIEW");
  const decided = rows.filter((r) => r.review.status !== "AWAITING_REVIEW");
  const approved = decided.filter((r) => r.review.status === "APPROVED").length;
  const rejected = decided.length - approved;
  const issues = decided.filter((r) => r.review.ticket_url).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${ctx.tenant.companyName} · Reviews`}
        title={pending.length ? `${pending.length} ${pending.length === 1 ? "decision is" : "decisions are"} waiting on you` : `Nothing is waiting on you for ${ctx.tenant.companyName}`}
        description="AI detected the conflict and drafted the memo — that is a recommendation, not a decision. Approving opens a compliance-review issue in the connected repository; rejecting records the decision. Nothing external happens until you decide."
      />
      <OtherCompanyReviews rows={elsewhere} switchTenant={switchTenant} />

      <StatGrid>
        <Stat label="Waiting" value={pending.length} tone={pending.length ? "destructive" : "default"} hint="awaiting your decision" />
        <Stat label="Approved" value={approved} tone={approved ? "success" : "default"} hint={issues ? `${issues} ${issues === 1 ? "issue" : "issues"} opened` : "no issues opened yet"} />
        <Stat label="Rejected" value={rejected} hint="no action taken" />
        <Stat label="Total reviewed" value={decided.length} hint="recorded in the audit log" />
      </StatGrid>

      <section className="space-y-3">
        <SectionHeader title="Needs your decision" count={pending.length} description="Review opens the analysis with the evidence and the draft memo." />
        <ReviewQueue rows={pending} />
      </section>

      {decided.length ? (
        <section className="space-y-3">
          <SectionHeader title="Decided" count={decided.length} description="Every decision is recorded under the reviewer's GitHub login." />
          <ReviewQueue rows={decided} decided />
        </section>
      ) : null}
    </div>
  );
}
