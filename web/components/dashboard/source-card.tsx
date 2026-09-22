"use client";

import { ArrowUpRight, Database, FileText, GitBranch, Globe, Landmark } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { sourceCounts, type Source, type SourceKind } from "@/lib/sources";
import { cn } from "@/lib/utils";

/** The site's own icon when the source has a site and it loads; otherwise the provenance-level glyph — never a generic globe for a known source. */
export function SourceIcon({ kind, favicon, className }: { kind: SourceKind; favicon?: string | null; className?: string }) {
  const c = cn("size-3.5", className);
  if (favicon) return <SiteIcon src={favicon} fallback={<SourceIcon kind={kind} className={className} />} />;
  if (kind === "regulator") return <Landmark aria-hidden className={c} />;
  if (kind === "policy") return <GitBranch aria-hidden className={c} />;
  if (kind === "retrieval") return <Database aria-hidden className={c} />;
  return <Globe aria-hidden className={c} />;
}

function SiteIcon({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={14} height={14} referrerPolicy="no-referrer" className="size-3.5 rounded-sm object-contain" onError={() => setFailed(true)} />;
}

const LEVEL: Record<SourceKind, string> = { regulator: "Live regulator source", policy: "Internal policy", retrieval: "Retrieval result", web: "Web discovery" };

function StatusBadge({ s }: { s: Source }) {
  if (s.status === "LIVE") return <Badge variant="outline" className="border-success/40 text-[10px] text-success">LIVE</Badge>;
  if (s.status === "DEMO_SNAPSHOT") return <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">DEMO SNAPSHOT · synthetic</Badge>;
  if (s.status === "INTERNAL") return <Badge variant="outline" className="text-[10px]">INTERNAL · fictional PoC tenant</Badge>;
  if (s.status === "RETRIEVED") return <Badge variant="outline" className="text-[10px]">RETRIEVED{s.rank ? ` · rank ${s.rank}` : ""}</Badge>;
  return <Badge variant="outline" className="text-[10px]">DISCOVERY</Badge>;
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  const internal = href.startsWith("/");
  const cls = "inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline";
  return internal ? (
    <Link href={href} className={cls}>{children}</Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>{children} <ArrowUpRight aria-hidden className="size-3" /></a>
  );
}

/** Compact provenance card: where it comes from, what it says, exactly where to open it. */
export function SourceCard({ s, compact }: { s: Source; compact?: boolean }) {
  const openLabel = s.kind === "regulator" ? (s.status === "LIVE" ? `Open ${s.label} source` : "Snapshot record") : s.kind === "policy" ? "Open on GitHub" : s.kind === "web" ? "Open on sebi.gov.in" : null;
  return (
    <li className="rounded-lg border border-border bg-card/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <SourceIcon kind={s.kind} favicon={s.favicon_url} /> {LEVEL[s.kind]}
        </span>
        <span className="text-[11px] text-muted-foreground">· {s.label}{s.domain ? ` · ${s.domain}` : ""}</span>
        <StatusBadge s={s} />
      </div>
      <p className="mt-1.5 leading-6">
        {s.document_id && s.kind !== "regulator" ? <span className="font-mono text-xs">{s.document_id}</span> : null}
        {s.section ? <span className="font-mono text-xs">{s.document_id && s.kind !== "regulator" ? " " : ""}§{s.section}</span> : null}
        {s.section || (s.document_id && s.kind !== "regulator") ? " · " : ""}
        <span className="font-medium">{s.title}</span>
        {s.reference ? <span className="ml-2 font-mono text-[11px] text-muted-foreground">{s.reference}</span> : null}
      </p>
      {s.excerpt && !compact ? <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-muted-foreground">“{s.excerpt}”</p> : null}
      {s.path ? <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{s.repository ? `${s.repository}/` : ""}{s.path}{s.commit_sha ? ` @ ${s.commit_sha.slice(0, 7)}` : ""}</p> : null}
      {s.score !== undefined && s.score !== null ? <p className="mt-1 text-[11px] text-muted-foreground">Hybrid retrieval (BM25 + vector, RRF) · score {s.score.toFixed(4)}</p> : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {s.url && openLabel ? <ExtLink href={s.url}>{openLabel}</ExtLink> : null}
        {s.pdf_url ? <ExtLink href={s.pdf_url}><FileText aria-hidden className="size-3" /> Open PDF</ExtLink> : null}
        {s.workspace_href ? <ExtLink href={s.workspace_href}>View in workspace</ExtLink> : null}
        {!s.url && !s.workspace_href ? <span className="text-[11px] text-muted-foreground">No link recorded for this source</span> : null}
      </div>
    </li>
  );
}

export function SourceList({ sources, compact, className }: { sources: Source[]; compact?: boolean; className?: string }) {
  if (!sources.length) return null;
  const c = sourceCounts(sources);
  const parts = [c.regulatory ? `${c.regulatory} regulatory` : null, c.internal ? `${c.internal} internal` : null, c.retrieved ? `${c.retrieved} retrieved` : null, c.web ? `${c.web} web` : null].filter(Boolean);
  return (
    <div className={cn("space-y-2", className)}>
      <ul className="space-y-2">
        {sources.map((s) => (
          <SourceCard key={s.id} s={s} compact={compact} />
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        {c.total} source{c.total === 1 ? "" : "s"}{parts.length ? ` · ${parts.join(" · ")}` : ""}
      </p>
    </div>
  );
}
