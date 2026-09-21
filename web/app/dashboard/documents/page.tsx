import type { Metadata } from "next";
import { Suspense } from "react";
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
    <div className="space-y-6">
      <PageHeader eyebrow={`${ctx.tenant.companyName} · Documents`} title="Regulatory publications" description="Every circular processed for this workspace, with its impact on your policies and where it stands." meta={<span>{documents.data.length} processed</span>} />
      {documents.error ? (
        <Alert variant="error">
          <AlertTitle>Could not load documents</AlertTitle>
          <AlertDescription>{documents.error}</AlertDescription>
        </Alert>
      ) : null}
      <Suspense>
        <DocumentsView documents={documents.data} />
      </Suspense>
    </div>
  );
}
