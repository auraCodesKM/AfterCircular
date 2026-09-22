"""Compliance ticket payload — pure function, tested. Follows the repo's .github/ISSUE_TEMPLATE/compliance-review.md."""

from app.schemas.actions import AnalysisRecord, ProcessedDocument, ReviewRecord, TicketPayload
from app.schemas.impact import ImpactAnalysis, Memo
from app.schemas.obligations import ExtractionResult

MARKER = "AfterCircular-Analysis-ID:"


def build_ticket(doc: ProcessedDocument, analysis: AnalysisRecord, review: ReviewRecord) -> TicketPayload:
    impact = ImpactAnalysis.model_validate(analysis.impact)
    extraction = ExtractionResult.model_validate(analysis.extraction)
    memo = Memo.model_validate(analysis.memo) if analysis.memo else None
    affected = ", ".join(impact.affected_policies) or "—"
    first_policy = impact.policy_evidence[0] if impact.policy_evidence else None
    title = f"[Compliance] {doc.source} {doc.circular_number or doc.document_id} vs {first_policy.doc_id + ' §' + first_policy.section if first_policy else affected}"
    demo = "\n> **Demo snapshot:** this circular is fictional (`source_mode = DEMO_SNAPSHOT`).\n" if doc.source_mode == "DEMO_SNAPSHOT" else ""
    reg_ev = "\n".join(f"  - §{e.section}: “{e.text}”" for e in impact.regulatory_evidence) or "  - —"
    pol_src = (analysis.impact or {}).get("policy_sources") or {}  # provenance merged by the pipeline: doc_id → {path, url, repo, branch}
    pol_ev = "\n".join(f"  - {e.doc_id} §{e.section}: “{e.text}”" + (f" ([{pol_src[e.doc_id]['path']}]({pol_src[e.doc_id]['url']}))" if e.doc_id in pol_src else "")
                       for e in impact.policy_evidence) or "  - —"
    body = f"""{demo}
## Regulatory change
- **Source:** {doc.source} ({doc.jurisdiction}) · {doc.source_mode}{(' · fetched ' + doc.fetched_at.isoformat()) if doc.fetched_at else ''}
- **Reference:** {doc.circular_number or '—'}, published {doc.published_date or '—'}, {doc.url}
- **Official PDF:** {doc.document_url or '—'}
- **Title:** {doc.title}
- **Summary:** {extraction.summary}
- **Clause(s):**
{reg_ev}

## Affected internal document
- **Document(s):** {affected}
- **Clause(s):**
{pol_ev}

## Impact analysis
- **Applicability:** {impact.applicability}
- **Alignment:** {impact.alignment or '—'}
- **Severity (model-rated):** {impact.severity or '—'}
- **Decision path:** {' → '.join(analysis.decision_path) or '—'}{(' · escalated: ' + analysis.escalation_reason) if analysis.escalation_reason else ''}
- **Effective date:** {impact.effective_date or extraction.effective_date or '—'}
- **Reasoning:** {impact.reason}
- **Recommended action:** {impact.recommended_action or '—'}

## Proposed amendment
> AI-generated draft — human review required
{memo.proposed_amendment if memo else '_No memo drafted._'}

{('**Identified gap:** ' + memo.identified_gap) if memo else ''}

## Decision
- [x] Approved by {review.decided_by or 'reviewer'} on {review.decided_at.date() if review.decided_at else '—'} — {review.note or 'no note'}
- [ ] Pull request opened
- [ ] Merged

---
_Opened by AfterCircular after human approval. Models: {', '.join(f'{k}={v}' for k, v in analysis.models.items())} (provider: {analysis.ai_provider})._
_{MARKER} {analysis.id}_
"""
    labels = ["compliance", "needs-review"] + ([f"severity:{impact.severity}"] if impact.severity else [])
    return TicketPayload(title=title[:250], body=body.strip(), labels=labels)
