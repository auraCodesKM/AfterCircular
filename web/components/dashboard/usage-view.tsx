import { Cpu, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Marker, MarkerContent, MarkerIcon } from "@/components/xiod/marker";
import type { Usage } from "@/lib/pipeline-types";

const NA = "Not available";
const n = (v: number | null | undefined) => (v === null || v === undefined ? NA : v.toLocaleString());
const usd = (v: number | null | undefined, digits = 4) => (v === null || v === undefined ? NA : `$${v.toFixed(digits)}`);
const ms = (v: number | null | undefined) => (v === null || v === undefined ? NA : `${v.toLocaleString()} ms`);

/** Model usage and the application's own spend circuit breakers — every figure is a sum of what the backend recorded. */
export function UsageView({ usage }: { usage: Usage | null }) {
  if (!usage) {
    return <p className="text-sm text-muted-foreground">Usage: {NA} — the backend did not answer.</p>;
  }
  const b = usage.budget;
  const scanSpent = usage.scan?.estimated_cost_usd ?? 0;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Marker variant="border" render={<h2 />}>
          <MarkerIcon><Cpu /></MarkerIcon>
          <MarkerContent className="font-medium text-foreground">Deployments · {usage.period === "today" ? "today" : "all time"}</MarkerContent>
        </Marker>
        {usage.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">No model calls recorded {usage.period === "today" ? "today" : "yet"}.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {["Model", "Requests", "Input", "Output", "Cached", "Estimated", "Avg latency", "Errors", "Retried"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usage.models.map((m) => (
                  <tr key={`${m.model}-${m.provider}`} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{m.model}</span>
                        {usage.active_model === m.model ? <Badge variant="outline">active deployment</Badge> : null}
                        {m.pricing_status === "unknown" ? <Badge variant="secondary">pricing unknown</Badge> : null}
                      </div>
                      <span className="text-[11px] text-muted-foreground">{m.provider}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{n(m.requests)}</td>
                    <td className="px-3 py-2 tabular-nums">{n(m.input_tokens)}</td>
                    <td className="px-3 py-2 tabular-nums">{n(m.output_tokens)}</td>
                    <td className="px-3 py-2 tabular-nums">{n(m.cached_tokens)}</td>
                    <td className="px-3 py-2 tabular-nums">{usd(m.estimated_cost_usd)}</td>
                    <td className="px-3 py-2 tabular-nums">{ms(m.avg_latency_ms)}</td>
                    <td className="px-3 py-2 tabular-nums">{n(m.errors)}</td>
                    <td className="px-3 py-2 tabular-nums">{n(m.retried)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Totals: {n(usage.requests)} requests · {n(usage.input_tokens)} in · {n(usage.output_tokens)} out · {n(usage.cached_tokens)} cached · {usd(usage.estimated_cost_usd)} ·
          TOON context on {n(usage.toon_calls)} call{usage.toon_calls === 1 ? "" : "s"}. Costs are list-price estimates recorded per call, not Azure billing.
          {usage.unknown_pricing_calls ? ` ${usage.unknown_pricing_calls} call(s) had no price and count as $0.` : ""}
        </p>
      </section>

      <section className="space-y-3">
        <Marker variant="border" render={<h2 />}>
          <MarkerIcon><Wallet /></MarkerIcon>
          <MarkerContent className="font-medium text-foreground">Budget · application circuit breakers</MarkerContent>
        </Marker>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-baseline justify-between border-b border-border/60 py-1">
            <dt className="text-muted-foreground">Latest scan{usage.scan ? ` · ${usage.scan.status.toLowerCase()}` : ""}</dt>
            <dd className="tabular-nums">{usage.scan ? `${usd(scanSpent)} / ${usd(b.scan_limit_usd, 2)}` : NA}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-border/60 py-1">
            <dt className="text-muted-foreground">Today, all companies</dt>
            <dd className="tabular-nums">{usd(b.spent_today_usd)} / {usd(b.daily_limit_usd, 2)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-border/60 py-1">
            <dt className="text-muted-foreground">Remaining today</dt>
            <dd className="tabular-nums">{usd(b.daily_remaining_usd)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-border/60 py-1">
            <dt className="text-muted-foreground">Calls per scan · latest scan</dt>
            <dd className="tabular-nums">{usage.scan ? `${usage.scan.llm_calls} / ${b.max_llm_calls_per_scan}` : NA}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{b.note}</p>
      </section>
    </div>
  );
}
