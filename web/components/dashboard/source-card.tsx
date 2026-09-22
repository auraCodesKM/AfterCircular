"use client";

import { Database, GitBranch, Globe, Landmark } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { SourceKind } from "@/lib/sources";
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
