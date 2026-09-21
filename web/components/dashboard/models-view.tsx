import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EvalReport, Health } from "@/lib/pipeline-types";
import { EmptyState } from "./empty-state";
import { Cpu } from "lucide-react";
import { fmtTime } from "./labels";

const pct = (n: number | null | undefined) => (n == null ? "Not evaluated" : `${Math.round(n * 100)}%`);
const num = (n: number | null | undefined, suffix = "") => (n == null ? "—" : `${n}${suffix}`);

const TASKS: { task: string; kind: "judge" | "generative"; key: string }[] = [
  { task: "Obligation extraction", kind: "generative", key: "extraction" },
  { task: "Obligation check", kind: "judge", key: "extraction_check" },
  { task: "Applicability", kind: "judge", key: "applicability" },
  { task: "Policy relevance (rerank)", kind: "judge", key: "rerank" },
  { task: "Alignment", kind: "judge", key: "alignment" },
  { task: "Citation check", kind: "judge", key: "verification" },
  { task: "Complex interpretation (escalation)", kind: "generative", key: "impact" },
  { task: "Memo generation", kind: "generative", key: "memo" },
];

export function ModelsView({ health, evals }: { health: Health | null; evals: EvalReport | null }) {
  const judge = health?.judge;
  const judgeName = (task: string) => {
    const r = judge?.routes?.[task] ?? judge?.default ?? "—";
    return r === "typesafe" ? `Jev · ${judge?.model ?? "jev-latest"}` : r === "foundry" ? "Foundry (uncalibrated emulation)" : r === "stub" ? "stub · fixture" : r;
  };
  const genName = (key: string) => (health?.ai_provider === "foundry" ? (health.models[key] ?? "—") : "stub · fixture");
  const models = [
    { name: "Jev", vendor: "TypeSafe System One", role: "Typed judgments with calibrated probabilities", status: judge?.typesafe_configured ? "configured" : "not configured" },
    { name: "Foundry", vendor: "Microsoft Foundry / Azure OpenAI", role: "Generation and reasoning", status: health?.ai_provider === "foundry" ? "configured" : "not configured" },
    { name: "Stub", vendor: "Local fixtures", role: "Evaluation and tests only — no model calls", status: "always available" },
  ];

  return (
    <Tabs defaultValue="routing">
      <TabsList>
        <TabsTrigger value="routing">Task routing</TabsTrigger>
        <TabsTrigger value="judges">Judgment benchmark</TabsTrigger>
        <TabsTrigger value="generative">Generative benchmark</TabsTrigger>
      </TabsList>

      <TabsContent value="routing" className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          {models.map((m) => (
            <Card key={m.name} size="sm">
              <CardHeader>
                <CardTitle>{m.name}</CardTitle>
                <CardDescription>{m.vendor}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs">
                <p>{m.role}</p>
                <p className={`mt-1 ${m.status === "not configured" ? "text-warning" : "text-muted-foreground"}`}>{m.status}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Task</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TASKS.map((t) => (
                <TableRow key={t.key}>
                  <TableCell className="font-medium">{t.task}</TableCell>
                  <TableCell className="text-muted-foreground">{t.kind === "judge" ? "typed judgment" : "generative"}</TableCell>
                  <TableCell className="font-mono text-xs">{t.kind === "judge" ? judgeName(t.key) : genName(t.key)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Routing comes from DECISION_ROUTES / DEFAULT_JUDGE and the per-task Foundry deployments in backend/.env.</p>
      </TabsContent>

      <TabsContent value="judges">
        {evals?.judges ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {evals.judges.scenarios.length} golden scenarios · run {fmtTime(evals.judges.generated_at)} · thresholds {JSON.stringify(evals.judges.thresholds)}
            </p>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Judge</TableHead>
                    <TableHead>Applicability</TableHead>
                    <TableHead>Alignment</TableHead>
                    <TableHead>Affected</TableHead>
                    <TableHead>Evidence verbatim</TableHead>
                    <TableHead>Rerank hit</TableHead>
                    <TableHead>Escalated</TableHead>
                    <TableHead>Brier</TableHead>
                    <TableHead>Req / case</TableHead>
                    <TableHead>Tokens / case</TableHead>
                    <TableHead>Latency / case</TableHead>
                    <TableHead>Cost / case</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evals.judges.summary.map((r) => (
                    <TableRow key={r.judge}>
                      <TableCell className="font-mono text-xs">
                        {r.judge} · {r.models.join(", ")}
                        {r.calibrated ? "" : " · self-reported"}
                      </TableCell>
                      <TableCell>{pct(r.applicability_accuracy)}</TableCell>
                      <TableCell>{pct(r.alignment_accuracy)}</TableCell>
                      <TableCell>{pct(r.affected_accuracy)}</TableCell>
                      <TableCell>{pct(r.evidence_verbatim_rate)}</TableCell>
                      <TableCell>{pct(r.rerank_hit_rate)}</TableCell>
                      <TableCell>{pct(r.escalation_rate)}</TableCell>
                      <TableCell>{num(r.brier_mean)}</TableCell>
                      <TableCell>{num(r.requests_per_case)}</TableCell>
                      <TableCell>{num(r.input_tokens_per_case)}</TableCell>
                      <TableCell>{num(r.latency_ms_per_case, " ms")}</TableCell>
                      <TableCell>{r.estimated_cost_per_case == null ? "—" : `$${r.estimated_cost_per_case}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {evals.judges.note ? <p className="text-xs text-muted-foreground">{evals.judges.note}</p> : null}
          </div>
        ) : (
          <EmptyState icon={Cpu} title="Not evaluated" description="Run `python -m evals.judges --judges typesafe,foundry,stub` in backend/ to benchmark the judgment layer." />
        )}
      </TabsContent>

      <TabsContent value="generative">
        {evals?.available ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {evals.scenarios.length} scenarios · {evals.retrieval} · run {fmtTime(evals.generated_at)}
            </p>
            {evals.warning ? <p className="text-xs text-warning">{evals.warning}</p> : null}
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Model</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>JSON valid</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evals.summary.map((r) => (
                    <TableRow key={`${r.model}-${r.task}`}>
                      <TableCell className="font-mono text-xs">{r.model}</TableCell>
                      <TableCell>{r.task}</TableCell>
                      <TableCell>{pct(r.quality_score)}</TableCell>
                      <TableCell>{pct(r.json_valid_rate)}</TableCell>
                      <TableCell>{pct(r.evidence_accuracy)}</TableCell>
                      <TableCell>{num(r.latency_ms_median, " ms")}</TableCell>
                      <TableCell>{r.input_tokens == null ? "—" : `${r.input_tokens} / ${r.output_tokens}`}</TableCell>
                      <TableCell>{r.estimated_cost_total == null ? "—" : `$${r.estimated_cost_total}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <EmptyState icon={Cpu} title="Not evaluated" description={evals && !evals.available ? evals.message : "Run `python -m evals.run` in backend/ with Foundry configured."} />
        )}
      </TabsContent>
    </Tabs>
  );
}
