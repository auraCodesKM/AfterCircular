import type { Metadata } from "next";
import { DocumentsTable } from "@/components/dashboard/documents-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { load, shellContext } from "@/lib/dashboard-data";
import type { ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const ctx = await shellContext();
  const [documents, reviews] = await Promise.all([load<ProcessedDocument[]>(ctx, "/api/documents", []), load<ReviewRecord[]>(ctx, "/api/reviews", [])]);
  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Every regulatory publication AfterCircular has processed for this workspace, newest first." />
      {documents.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load documents</AlertTitle>
          <AlertDescription>{documents.error}</AlertDescription>
        </Alert>
      ) : null}
      <DocumentsTable documents={documents.data} reviews={reviews.data} />
    </div>
  );
}
