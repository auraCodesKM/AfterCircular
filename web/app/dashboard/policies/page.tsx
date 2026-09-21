import { BookOpen, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/dashboard/empty-state";
import { fmtTime } from "@/components/dashboard/labels";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { load, shellContext } from "@/lib/dashboard-data";
import type { PolicyIndex } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Policies" };

export default async function PoliciesPage() {
  const ctx = await shellContext();
  const { data } = await load<PolicyIndex>(ctx, "/api/policies", { index: null, documents: [] });
  const repoUrl = `https://github.com/${ctx.tenant.githubRepo}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Policies"
        description="The internal policy corpus retrieval searches — read from the default branch of the connected repository and chunked by section."
        meta={
          data.index ? (
            <>
              <span className="font-mono">
                {data.index.repo}@{data.index.commit_sha.slice(0, 7)}
              </span>
              <span>{data.index.chunk_count} chunks</span>
              <span>indexed {fmtTime(data.index.indexed_at)}</span>
              <span>{ctx.health?.retrieval === "azure-ai-search" ? "Azure AI Search" : "local hybrid index"}</span>
            </>
          ) : undefined
        }
      />
      {data.documents.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Document</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Sections</TableHead>
                <TableHead>Vectors</TableHead>
                <TableHead className="text-right">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.documents.map((d) => (
                <TableRow key={d.doc_id}>
                  <TableCell>
                    <p className="font-medium">{d.title}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {d.doc_id} · {d.path}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{d.version ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.sections.length}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{d.embedded ? "embedded" : "keyword only"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <a href={`${repoUrl}/blob/${ctx.tenant.defaultBranch}/${d.path}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline">
                      GitHub <ExternalLink aria-hidden className="size-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="No policies indexed yet" description="The repository is read and chunked on the first scan." />
      )}
    </div>
  );
}
