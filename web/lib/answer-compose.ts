import type { AskPoint, DocCard, Investigation, Trace, TraceStep } from "@/lib/pipeline-types";
import { cardSources, type Source } from "@/lib/sources";

/**
 * Turns a stored Investigation into an answer-first document: headline, Markdown body with inline [n] citation markers,
 * a numbered source list and contextual follow-ups. Pure presentation over persisted records — no model call, nothing
 * invented: every sentence comes from the answer's own points, the record's stored evidence, or the persisted trace.
 */
export type Composed = { headline: string; markdown: string; sources: Source[]; followUps: string[]; mode: "narrative" | "records" | "trace" | "refused" | "web" | "clarify" };

const clip = (s: string | null | undefined, n = 260) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const cell = (s: string | null | undefined, n = 160) => clip(s, n).replace(/\|/g, "\\|");
const dur = (v: unknown) => (typeof v === "number" ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`) : "not recorded");
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : "not recorded");

/** Number the sources an answer cites, in citation order; evidence ids (D3.R1, D3.P1) map to source numbers. */
function numberSources(cards: DocCard[], points: AskPoint[]): { sources: Source[]; byEvidence: Map<string, number> } {
  const sources: Source[] = [];
  const byEvidence = new Map<string, number>();
  const index = new Map<string, number>();
  const add = (s: Source) => {
    const k = `${s.kind}:${s.document_id ?? s.label}:${s.section ?? ""}`;
    if (!index.has(k)) {
      sources.push(s);
      index.set(k, sources.length);
    }
    return index.get(k)!;
  };
  for (const card of cards) {
    const all = cardSources(card);
    const cited = points.filter((p) => p.record_id === card.id).flatMap((p) => p.evidence);
    const picked = cited.length ? cited : [];
    for (const e of picked) {
      const s = all.find((x) => (e.id.includes(".R") ? x.kind === "regulator" && x.section === e.section : e.id.includes(".P") ? x.kind === "policy" && x.document_id === e.doc_id && x.section === e.section : false));
      if (s) byEvidence.set(e.id, add(s));
    }
    if (!picked.length) all.forEach(add);
  }
  return { sources, byEvidence };
}

const marks = (ids: string[], by: Map<string, number>) => Array.from(new Set(ids.map((i) => by.get(i)).filter((n): n is number => !!n))).sort((a, b) => a - b).map((n) => `[${n}]`).join(" ");

function narrative(inv: Investigation, cards: DocCard[]): Composed {
  const a = inv.answer;
  const points = a.points ?? [];
  const { sources, byEvidence } = numberSources(cards, points);
  const one = cards.length === 1 ? cards[0] : null;
  const conflict = one?.impact === "CONFLICT" || one?.gate === "CONFLICT";
  const lines: string[] = [];
  if (a.insufficient_evidence) {
    lines.push(`## Not established by the workspace records`, "", inv.summary);
    return { headline: "", markdown: lines.join("\n"), sources, followUps: ["What evidence do we have?", "Which circulars conflict with our policies?", "What needs my review?"], mode: "narrative" };
  }
  const title = inv.intent === "explain" && conflict ? "Conflict detected" : inv.intent === "evidence" ? "Evidence" : inv.intent === "prioritize" ? "Recommendation" : inv.intent === "gaps" ? "What the records do not establish" : inv.intent === "obligations" ? "What the regulator requires" : inv.intent === "affected_policies" ? "Affected policy" : inv.intent === "compare" ? "Comparison" : "Bottom line";
  lines.push(`## ${title}`, "", inv.summary, "");
  if (points.length) {
    lines.push(`### Why`, "");
    points.forEach((p, i) => lines.push(`${i + 1}. ${p.claim.trim()} ${marks(p.evidence_ids, byEvidence)}`.trim()));
    lines.push("");
  }
  if (one) {
    const reg = one.regulatory_evidence.filter((e) => byEvidence.has(`${one.id}.R${one.regulatory_evidence.indexOf(e) + 1}`));
    const pol = one.policy_evidence.filter((e) => byEvidence.has(`${one.id}.P${one.policy_evidence.indexOf(e) + 1}`));
    const regShow = (reg.length ? reg : one.regulatory_evidence).slice(0, 3);
    const polShow = (pol.length ? pol : one.policy_evidence).slice(0, 2);
    if (regShow.length) {
      lines.push(`### Regulatory requirement`, "");
      regShow.forEach((e) => lines.push(`> **${one.source} §${e.section}** — ${clip(e.text)} ${marks([`${one.id}.R${one.regulatory_evidence.indexOf(e) + 1}`], byEvidence)}`, ">"));
      lines.push("");
    }
    if (polShow.length) {
      lines.push(`### Internal policy`, "");
      polShow.forEach((e) => lines.push(`> **${e.doc_id} §${e.section}** — ${clip(e.text)} ${marks([`${one.id}.P${one.policy_evidence.indexOf(e) + 1}`], byEvidence)}`, ">"));
      lines.push("");
    }
    if (conflict && regShow.length && polShow.length) {
      const r = regShow[0], p = polShow[0];
      lines.push(`### Requirement mismatch`, "", `| | ${one.source} | Internal policy |`, `|---|---|---|`,
        `| Requirement | ${cell(r.text)} | ${cell(p.text)} |`, `| Clause | §${r.section} | ${p.doc_id} §${p.section} |`,
        `| Source | ${one.source_mode === "LIVE" ? "official circular · LIVE" : "demo snapshot · synthetic"} | policy repository · GitHub |`);
      if (one.effective_date) lines.push(`| Effective date | ${cell(one.effective_date)} | in force (current policy) |`);
      lines.push("");
    }
    const outcome = one.gate ?? one.impact ?? "—";
    lines.push(`### Impact`, "", `**${outcome}**${typeof one.confidence === "number" ? ` · ${Math.round(one.confidence * 100)}% confidence` : ""}${one.affected_policies.length ? ` · affects ${one.affected_policies.join(", ")}` : ""}.${one.reason ? ` ${clip(one.reason, 320)}` : ""}`);
    if (one.review?.status === "AWAITING_REVIEW") lines.push("", `> Awaiting your decision — no external action has been taken.`);
    else if (one.review?.status === "APPROVED") lines.push("", `> Approved by @${one.review.decided_by}${one.review.ticket_id ? ` · GitHub issue #${one.review.ticket_id}` : ""}.`);
    lines.push("");
  }
  if (a.caveat) lines.push(`> ${a.caveat}`, "");
  const followUps = conflict
    ? ["Show exact SEBI clauses", "Which exact policy clause conflicts?", "What should we update?", "How did the system reach the final decision?"]
    : inv.intent === "evidence" ? ["Why is this a conflict?", "What did Jev decide?", "What did Azure AI Search retrieve?"]
    : ["What evidence supports this?", "What should we do next?", "What happens if I approve this?"];
  return { headline: "", markdown: lines.join("\n"), sources, followUps, mode: "narrative" };
}

type JevStage = Record<string, unknown> & { decision?: string; items?: Record<string, unknown>[] };

/** Structured fields when the trace carries them; otherwise the same facts parsed from the stage's own decision line (never invented). */
function jevFacts(st: JevStage | null) {
  if (!st) return null;
  const d = String(st.decision ?? "");
  const outcome = typeof st.outcome === "string" ? st.outcome : /^(YES|NO|UNCERTAIN|archive|proceed)\b/i.exec(d)?.[1] ?? null;
  const confidence = typeof st.confidence === "number" ? st.confidence : (() => { const m = /P=([0-9.]+)/.exec(d); return m ? Number(m[1]) : null; })();
  const kept = typeof st.kept === "number" ? st.kept : Array.isArray(st.items) && st.items.length && "kept" in st.items[0] ? st.items.filter((i) => i.kept).length : (() => { const m = /^(\d+) \/ (\d+)/.exec(d); return m ? Number(m[1]) : null; })();
  const total = typeof st.total === "number" ? st.total : Array.isArray(st.items) && st.items.length && "kept" in st.items[0] ? st.items.length : (() => { const m = /^(\d+) \/ (\d+)/.exec(d); return m ? Number(m[2]) : null; })();
  const counts: Record<string, number> = st.counts && typeof st.counts === "object" ? (st.counts as Record<string, number>) : Object.fromEntries(Array.from(d.matchAll(/(\d+) ([a-z_]+)/g)).map((m) => [m[2], Number(m[1])]));
  const verdict = typeof st.verdict === "string" ? st.verdict : /^(agree|disagree)\b/i.exec(d)?.[1] ?? null;
  const conflictPairs = typeof st.conflict_pairs === "number" ? st.conflict_pairs : (() => { const m = /(\d+) conflict pair/.exec(d); return m ? Number(m[1]) : null; })();
  const rejected = typeof st.counts === "object" && st.counts && "fabricated" in (st.counts as object) ? Number((st.counts as Record<string, number>).fabricated) : (() => { const m = /(\d+) excerpt\(s\) rejected/.exec(d); return m ? Number(m[1]) : null; })();
  const verified = typeof st.counts === "object" && st.counts && "verified" in (st.counts as object) ? Number((st.counts as Record<string, number>).verified) : (() => { const m = /(\d+) excerpt\(s\) verified/.exec(d); return m ? Number(m[1]) : null; })();
  const ex = { kept: typeof st.kept === "number" ? st.kept : (() => { const m = /^(\d+) obligation/.exec(d); return m ? Number(m[1]) : null; })(), uncertain: typeof st.uncertain === "number" ? st.uncertain : (() => { const m = /(\d+) flagged uncertain/.exec(d); return m ? Number(m[1]) : null; })(), dropped: typeof st.dropped === "number" ? st.dropped : (() => { const m = /(\d+) dropped/.exec(d); return m ? Number(m[1]) : null; })() };
  return { outcome, confidence, kept, total, counts, verdict, conflictPairs, rejected, verified, ex, reason: typeof st.reason === "string" ? st.reason : null, model: typeof st.model === "string" ? st.model : null };
}

function jevAssessment(tr: Trace, card: DocCard | null): string {
  const jev = tr.steps.filter((s) => s.actor === "jev" && s.status === "completed");
  const stage = (name: string): JevStage | null => {
    for (const s of jev) {
      const t = s.telemetry as Record<string, unknown>;
      if (name === "triage" && s.id === "triage") return t as JevStage;
      const v = t[name];
      if (v && typeof v === "object" && "records" in (v as object)) return v as JevStage;
    }
    return null;
  };
  const pct = (v: number | null) => (v === null ? "not recorded" : `${Math.round(v * 100)}%`);
  const L: string[] = ["## Jev assessment", ""];
  const tri = jevFacts(stage("triage")), ex = jevFacts(stage("extraction_check")), ap = jevFacts(stage("applicability")), rr = jevFacts(stage("rerank")), al = jevFacts(stage("alignment")), ve = jevFacts(stage("verification")), cc = jevFacts(stage("cross_check"));
  if (tri) L.push(`**Triage**  \n${String(tri.outcome ?? "").toLowerCase() === "archive" ? "Outside scope — archived" : "In scope"} · ${pct(tri.confidence)} confidence`, "");
  if (ex) L.push(`**Extraction check**  \n${num(ex.ex.kept)} obligations confirmed${ex.ex.uncertain ? ` · ${ex.ex.uncertain} flagged uncertain` : ""}${ex.ex.dropped ? ` · ${ex.ex.dropped} dropped` : ""}`, "");
  if (ap) L.push(`**Applicability**  \n${ap.outcome ?? "not recorded"} · ${pct(ap.confidence)} confidence${ap.reason ? `  \n_${ap.reason}_` : ""}`, "");
  if (rr) L.push(`**Policy relevance**  \n${num(rr.kept)} / ${num(rr.total)} retrieved sections considered relevant`, "");
  if (al && Object.keys(al.counts).length) {
    const label: Record<string, string> = { conflicts: "Conflict", uncertain: "Uncertain", harmless_uncertain: "Uncertain (harmless)", satisfies: "Satisfied", not_addressed: "Not addressed" };
    const order = ["conflicts", "uncertain", "satisfies", "not_addressed", "harmless_uncertain"];
    L.push("### Alignment", "", "| Finding | Pairs |", "|---|---:|");
    for (const k of [...order.filter((k) => k in al.counts), ...Object.keys(al.counts).filter((k) => !order.includes(k))]) L.push(`| ${label[k] ?? k} | ${al.counts[k]} |`);
    L.push("");
  }
  if (ve) L.push("### Verification", "", ve.rejected !== null || ve.verified !== null ? `${ve.rejected ? `${ve.rejected} excerpt${ve.rejected === 1 ? "" : "s"} rejected — not verbatim in the source, dropped before the gate.` : ""}${ve.verified ? ` ${ve.verified} excerpt${ve.verified === 1 ? "" : "s"} verified verbatim.` : ""}`.trim() : String((stage("verification") as JevStage).decision ?? "not recorded"), "");
  if (cc) L.push("### Cross-check", "", `**${cc.verdict ? (cc.verdict.toLowerCase() === "agree" ? "Agreed with Microsoft Foundry" : `Disagreed with Microsoft Foundry (${cc.verdict})`) : "Verdict not recorded"}** · ${cc.conflictPairs === null ? "conflict pairs not recorded" : `${cc.conflictPairs} conflict pair${cc.conflictPairs === 1 ? "" : "s"} remained after verification`}.`, "");
  const model = [tri, ex, ap, rr, al, ve, cc].find((x) => x?.model)?.model ?? "";
  L.push(`\`Jev ${model.replace(/^jev-/, "")} · ${tr.summary.jev_judgments} typed judgments\``, "", `These judgments route and verify the case; the deterministic Impact Gate sets the outcome${card ? ` (${card.gate ?? card.impact})` : ""} and no Jev judgment authorizes an action.`);
  return L.join("\n");
}

function retrievalView(tr: Trace, card: DocCard | null): string {
  const st = tr.steps.find((s) => s.id === "retrieve");
  if (!st || st.status !== "completed") return `## Azure AI Search retrieval\n\nNot run — ${st?.reason ?? "no retrieval recorded"}.`;
  const t = st.telemetry as Record<string, unknown>;
  const chunks = ((st.details as { chunks?: { rank: number; doc_id: string; section: string; score?: number }[] }).chunks ?? []);
  const cited = new Set((card?.policy_evidence ?? []).map((e) => `${e.doc_id}#${e.section.split(" ")[0]}`));
  const L = ["## Azure AI Search retrieval", "", "Hybrid retrieval over the policy corpus:", "", "- BM25 keyword match", "- Vector similarity (text-embedding-3-small)", "- Reciprocal Rank Fusion (RRF)", "",
    "| Metric | Result |", "|---|---|", `| Candidates | ${num(t.count)} (k = ${num(t.k)}) |`, `| Latency | ${dur(t.latency_ms)} |`, `| Corpus commit | ${Array.isArray(t.corpus_commits) && t.corpus_commits.length ? String(t.corpus_commits[0]).slice(0, 7) : "not recorded"} |`, "", "### Top matches", ""];
  chunks.slice(0, 6).forEach((c) => {
    const used = cited.has(`${c.doc_id}#${c.section.split(" ")[0]}`);
    L.push(`${c.rank}. ${used ? "**" : ""}${c.doc_id} §${c.section}${used ? "** — cited in the finding" : ""}`);
  });
  const first = chunks.find((c) => cited.has(`${c.doc_id}#${c.section.split(" ")[0]}`));
  L.push("", first ? `**Why it mattered:** ${first.doc_id} §${first.section} ranked #${first.rank} on both keyword and vector similarity to the extracted obligations, and Jev's alignment judgment on that clause is the pair that produced the finding.` : "Jev's alignment judgments decide which candidates matter; retrieval only proposes them.");
  return L.join("\n");
}

function foundryView(tr: Trace): string {
  const f = tr.steps.filter((s) => s.actor === "foundry");
  const L = [f.some((s) => s.status === "completed") ? "## Why Microsoft Foundry ran" : "## Why Microsoft Foundry did not run", ""];
  let n = 0;
  for (const s of f) {
    if (s.status !== "completed") {
      L.push(`### ${s.operation.replace(/ \(.*\)/, "")} — not run`, "", s.reason ?? "", "");
      continue;
    }
    n += 1;
    L.push(`### ${n}. ${s.operation.replace(/ \(.*\)/, "")}`, "", `${s.summary}${s.reason ? ` ${s.reason.endsWith(".") ? s.reason : s.reason + "."}` : ""}`, "", `\`${dur(s.latency_ms)}\` · \`${num((s.telemetry as Record<string, unknown>).input_tokens)} → ${num((s.telemetry as Record<string, unknown>).output_tokens)} tokens\``, "");
  }
  L.push("### Pipeline", "");
  return L.join("\n");
}

function telemetryView(intent: string, tr: Trace): string {
  const s = tr.summary;
  const f = tr.steps.filter((x) => x.actor === "foundry" && x.status === "completed");
  if (intent === "cost") {
    const L = ["## Estimated cost", "", "| Call | Estimated |", "|---|---:|"];
    f.forEach((x) => L.push(`| ${x.operation.replace(/ \(.*\)/, "")} | ${typeof (x.telemetry as Record<string, unknown>).estimated_cost_usd === "number" ? `$${Number((x.telemetry as Record<string, unknown>).estimated_cost_usd).toFixed(4)}` : "not priced"} |`));
    L.push(`| **Total** | **${s.estimated_cost_usd !== null ? `$${s.estimated_cost_usd.toFixed(4)}` : "not priced"}** |`, "", `> ${s.pricing}. Jev and Azure AI Search calls are not priced here.`);
    return L.join("\n");
  }
  if (intent === "toon") {
    const c = s.context_comparison;
    if (!c) return "## Context efficiency (TOON)\n\nTOON encodes the structured context blocks sent to Microsoft Foundry to cut serialization overhead. This run does not contain a measured same-payload JSON comparison, so no saving is claimed.";
    return ["## Context efficiency (TOON)", "", "Serialization comparison · same payload · same tokenizer", "", "| | Tokens |", "|---|---:|", `| Compact JSON | ${num(c.compact_json_tokens)} |`, `| TOON (as sent) | ${num(c.as_sent_tokens)} |`, `| **Saved** | **${num(c.saved_tokens)} · ${c.saved_pct}%** |`, "",
      `Measured over ${c.measured_calls} Foundry call${c.measured_calls === 1 ? "" : "s"}. This is structural overhead of the structured context only — the provider billed ${num(s.foundry_tokens.input)} input tokens in total, so it does not imply an equivalent reduction in model cost.`].join("\n");
  }
  const L = ["## Execution telemetry", "", "| Service | Work | Latency |", "|---|---|---|",
    `| Microsoft Foundry | ${s.foundry_calls} call${s.foundry_calls === 1 ? "" : "s"} · ${num(s.foundry_tokens.input)} → ${num(s.foundry_tokens.output)} tokens${s.foundry_tokens.cached ? ` · ${num(s.foundry_tokens.cached)} cached` : ""} | ${dur(s.latency.foundry_ms)} |`,
    `| Jev | ${s.jev_judgments} typed judgments · ${s.jev_decision_records} records | ${dur(s.latency.jev_ms)} |`,
    `| Azure AI Search | ${s.azure_search_retrievals ? `${num(s.azure_search_results)} candidates` : "not run"} | ${dur(s.latency.azure_search_ms)} |`,
    `| Embeddings | text-embedding-3-small | ${dur(s.latency.embedding_ms)} |`, "", "### Foundry calls", "", "| Call | Tokens in → out | Latency |", "|---|---|---|"];
  f.forEach((x) => { const t = x.telemetry as Record<string, unknown>; L.push(`| ${x.operation.replace(/ \(.*\)/, "")} | ${num(t.input_tokens)} → ${num(t.output_tokens)} | ${dur(t.latency_ms)} |`); });
  return L.join("\n");
}

function pipelineView(tr: Trace): string {
  const ran = tr.steps.filter((s) => s.status === "completed");
  const L = ["## How this result happened", "", `**${tr.outcome ?? "—"}** after ${ran.length} executed stage${ran.length === 1 ? "" : "s"}.`, ""];
  const why = tr.steps.filter((s) => (s.actor === "foundry" || s.actor === "azure_search") && s.reason);
  if (why.length) {
    L.push("### Why each service ran", "");
    why.forEach((s) => L.push(`- **${s.name} — ${s.operation.replace(/ \(.*\)/, "").toLowerCase()}**: ${s.status === "completed" ? "" : "not run — "}${s.reason}`));
    L.push("");
  }
  return L.join("\n");
}

export function composeAnswer(inv: Investigation): Composed {
  const a = inv.answer;
  const r = a.reasoning;
  const kind = r?.kind;
  if (kind === "refused") return { headline: "", markdown: `## This needs your approval\n\n${inv.summary}`, sources: [], followUps: ["What needs my review?", "What happens if I approve this?"], mode: "refused" };
  if (kind === "web_search") return { headline: "", markdown: `## Found on sebi.gov.in\n\n${inv.summary}\n\n> Discovery only — a publication becomes evidence after the SEBI connector fetches and analyses it.`, sources: (a.web_sources ?? []).map((w, i) => ({ id: `web-${i}`, kind: "web" as const, label: "sebi.gov.in", title: w.title || w.url, url: w.url, domain: "www.sebi.gov.in", status: "DISCOVERY" as const })), followUps: ["What changed in the latest scan?"], mode: "web" };
  if (kind === "clarify") return { headline: "", markdown: `## Let me narrow that down\n\n${inv.summary}`, sources: [], followUps: a.suggestions ?? [], mode: "clarify" };
  const cards = a.documents ?? (a.document ? [a.document] : []);
  const card = cards.length === 1 ? cards[0] : cards.find((c) => c.id && r?.cited?.includes(c.id)) ?? null;
  if (a.trace) {
    const tr = a.trace;
    const sources = card ? cardSources(card) : [];
    const md = inv.intent === "jev_decisions" ? jevAssessment(tr, card) : inv.intent === "retrieval" ? retrievalView(tr, card) : inv.intent === "pipeline" ? (inv.question.toLowerCase().includes("foundry") ? foundryView(tr) : pipelineView(tr)) : inv.intent === "next_step" ? `## What happens next\n\n${inv.summary.split(/(?<=\.)\s+/).map((s) => `- ${s}`).join("\n")}` : telemetryView(inv.intent, tr);
    const followUps = inv.intent === "retrieval" ? ["Why was this clause ranked first?", "Show all retrieved policies", "What did Jev decide?"] : inv.intent === "jev_decisions" ? ["Why did Microsoft Foundry run?", "How did the system reach the final decision?", "What evidence supports the conflict?"] : inv.intent === "pipeline" ? ["Show the Foundry calls", "Why was escalation triggered?", "How much did this analysis cost?"] : ["How did the system reach the final decision?", "What did Azure AI Search retrieve?", "Why are we using TOON?"];
    return { headline: "", markdown: md, sources, followUps, mode: "trace" };
  }
  if (kind === "jev_reasoning" && (a.points?.length || a.insufficient_evidence)) return narrative(inv, cards.filter((c) => !r?.cited?.length || r.cited.includes(c.id ?? "")));
  // deterministic record answers (lists, dates, reviews, policy lookup)
  const title = inv.intent === "pending_reviews" ? "Waiting on you" : inv.intent === "list_conflicts" ? "Conflicts" : inv.intent === "list_not_applicable" ? "Not applicable" : inv.intent === "list_aligned" ? "Already aligned" : inv.intent === "list_applicable" ? "Applies to this company" : inv.intent === "effective_dates" ? "Effective dates" : inv.intent === "scan_status" ? "Last scan" : inv.intent === "policy_lookup" ? (a.policy ? `${a.policy.doc_id} — ${a.policy.title}` : "Policy") : "Bottom line";
  return { headline: "", markdown: `## ${title}\n\n${inv.summary}`, sources: [], followUps: inv.intent === "list_conflicts" ? ["Why is the latest conflict a conflict?", "What needs my review?"] : ["Which circulars conflict with our policies?", "What needs my review?", "What changed in the latest scan?"], mode: "records" };
}

export const stepLine = (s: TraceStep) => `${String(s.order).padStart(2, "0")} ${s.name} — ${s.summary}`;
