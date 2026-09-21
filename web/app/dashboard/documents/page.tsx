import type { Metadata } from "next";
import { DocumentsView } from "@/components/dashboard/documents-view";
import { PageHeader } from "@/components/dashboard/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { load, shellContext } from "@/lib/dashboard-data";
import type { ProcessedDocument } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const ctx = await shellContext();
  const documents = await load<ProcessedDocument[]>(ctx, "/api/documents", []);
  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description="Every regulatory publication processed for this workspace." />
      {documents.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load documents</AlertTitle>
          <AlertDescription>{documents.error}</AlertDescription>
        </Alert>
      ) : null}
      <DocumentsView documents={documents.data} />
    </div>
  );
}
