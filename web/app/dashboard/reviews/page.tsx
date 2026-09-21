import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import { DocumentsTable } from "@/components/dashboard/documents-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { load, shellContext } from "@/lib/dashboard-data";
import type { ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const ctx = await shellContext();
  const [documents, reviews] = await Promise.all([load<ProcessedDocument[]>(ctx, "/api/documents", []), load<ReviewRecord[]>(ctx, "/api/reviews", [])]);
  const byDoc = new Map(reviews.data.map((r) => [r.document_pk, r]));
  const pending = documents.data.filter((d) => byDoc.get(d.id)?.status === "AWAITING_REVIEW");
  const decided = documents.data.filter((d) => byDoc.has(d.id) && byDoc.get(d.id)?.status !== "AWAITING_REVIEW");
  return (
    <div className="space-y-8">
      <PageHeader title="Reviews" description="Conflicts that need a human decision. AI drafted; nothing happens until you approve." />
      <section className="space-y-3">
        <h2 className="text-base font-medium">Awaiting your decision {pending.length ? <span className="ml-1 rounded-sm bg-destructive/10 px-1.5 text-xs text-destructive">{pending.length}</span> : null}</h2>
        {pending.length ? (
          <DocumentsTable documents={pending} reviews={reviews.data} />
        ) : (
          <EmptyState icon={ClipboardCheck} title="You're all caught up" description="No conflicts are waiting for approval." />
        )}
      </section>
      {decided.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-medium">Decided</h2>
          <DocumentsTable documents={decided} reviews={reviews.data} />
        </section>
      ) : null}
    </div>
  );
}
