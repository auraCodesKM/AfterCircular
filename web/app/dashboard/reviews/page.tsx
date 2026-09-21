import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const ctx = await shellContext();
  const [documents, reviews] = await Promise.all([load<ProcessedDocument[]>(ctx, "/api/documents", []), load<ReviewRecord[]>(ctx, "/api/reviews", [])]);
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
  return (
    <div className="space-y-6">
      <PageHeader title="Needs your review" description="AI detected and drafted. Nothing external happens until you decide." meta={<span>{pending.length} waiting</span>} />
      <ReviewQueue rows={pending} />
      {decided.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Decided</h2>
          <ReviewQueue rows={decided} decided />
        </section>
      ) : null}
    </div>
  );
}
