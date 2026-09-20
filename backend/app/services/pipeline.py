"""The scan pipeline: fetch → detect → extract → retrieve → analyze → gate → memo → review request.

Deterministic code owns state transitions, persistence, idempotency and audit. Models only understand, extract,
reason and draft. Nothing here executes a side effect; approval (services/reviews.py) does that.
"""

import logging
import traceback
from typing import Any

from app.agents.impact_analysis import analyze_impact
from app.agents.memo_generation import generate_memo
from app.agents.obligation_extraction import extract_obligations
from app.config import settings
from app.connectors.sebi import SEBIConnector
from app.models.provider import LLMProvider, LLMResult, provider
from app.retrieval.azure_search import retriever as make_retriever
from app.retrieval.base import Retriever
from app.schemas.actions import AnalysisRecord, ProcessedDocument, ReviewRecord, ScanRecord, ScanStep, TenantContext
from app.schemas.impact import PolicyChunk
from app.schemas.regulatory import RegulatoryDocument
from app.services import audit
from app.services.gate import cheap_prefilter, route
from app.services.policies import company_profile, ensure_indexed
from app.services.state import StateStore, new_id, now
from app.tools.github import GitHubClient

log = logging.getLogger(__name__)

# statuses a document can be re-processed from on the next scan (it never reached a decision)
RETRYABLE = {"DISCOVERED", "EXTRACTING", "RETRIEVING", "ANALYZING", "DRAFTING", "FAILED"}

STEPS = [
    ("connect", "Connecting to SEBI"),
    ("fetch", "Fetching publications"),
    ("detect", "Checking processed documents"),
    ("index", "Indexing internal policies"),
    ("extract", "Extracting obligations"),
    ("retrieve", "Searching internal policies"),
    ("analyze", "Analyzing impact"),
    ("gate", "Running Impact Gate"),
    ("memo", "Drafting memo"),
    ("review", "Requesting human review"),
]


class Scan:
    def __init__(self, db: StateStore, tenant: TenantContext, llm: LLMProvider | None = None, ret: Retriever | None = None, force: bool = False):
        self.db, self.tenant, self.force = db, tenant, force
        self.llm = llm or provider()
        self.ret = ret or make_retriever(db)
        self.rec: ScanRecord = db.create_scan(tenant.tenant_id, [ScanStep(key=k, label=l) for k, l in STEPS], self.llm.name, self.ret.name)

    # ---- step bookkeeping ----------------------------------------------------------------
    def step(self, key: str, status: str, detail: str | None = None) -> None:
        for s in self.rec.steps:
            if s.key == key:
                s.status, s.detail, s.at = status, detail, now()  # type: ignore[assignment]
        self.db.save_scan(self.rec)

    def _llm(self, res: LLMResult, ok: bool = True, error: str | None = None) -> dict[str, Any]:
        self.db.record_llm_call(tenant_id=self.tenant.tenant_id, scan_id=self.rec.id, task=res.task, model=res.model, provider=res.provider,
                                latency_ms=res.latency_ms, input_tokens=res.input_tokens, output_tokens=res.output_tokens, ok=int(ok), error=error)
        return {"model": res.model, "latency_ms": res.latency_ms, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens, "attempts": res.attempts}

    # ---- run ---------------------------------------------------------------------------
    async def run(self) -> ScanRecord:
        t = self.tenant
        audit.record(self.db, t.tenant_id, "SCAN_STARTED", actor=t.actor, actor_type="human", scan_id=self.rec.id, force=self.force)
        try:
            self.step("connect", "running")
            fetched = await SEBIConnector().fetch_documents(settings().sebi_max_documents)
            self.rec.source_mode = fetched.mode
            self.step("connect", "done", "LIVE sebi.gov.in" if fetched.mode == "LIVE" else "DEMO SNAPSHOT (fictional, live source unavailable or disabled)")
            self.step("fetch", "done", f"{len(fetched.documents)} publication(s)" + (f"; {len(fetched.warnings)} warning(s)" if fetched.warnings else ""))

            self.step("detect", "running")
            new_docs = [self.detect(d) for d in fetched.documents]
            fresh = [d for d in new_docs if d is not None]
            self.rec.new_documents, self.rec.skipped_documents = len(fresh), len(fetched.documents) - len(fresh)
            self.rec.document_ids = [d.id for d in fresh]
            self.step("detect", "done", f"{len(fresh)} new, {self.rec.skipped_documents} already processed")

            if not fresh:
                for k in ("index", "extract", "retrieve", "analyze", "gate", "memo", "review"):
                    self.step(k, "skipped", "nothing new")
            else:
                self.step("index", "running")
                gh = GitHubClient(t.github_token)
                manifest, reindexed = await ensure_indexed(self.db, gh, t, self.ret, self.llm.embed)
                meta = self.db.policy_index_meta(t.tenant_id) or {}
                if reindexed:
                    audit.record(self.db, t.tenant_id, "POLICIES_INDEXED", scan_id=self.rec.id, repo=t.github_repo, commit=meta.get("commit_sha"), chunks=meta.get("chunk_count"), backend=self.ret.name)
                self.step("index", "done", f"{meta.get('chunk_count', 0)} chunks from {t.github_repo}@{str(meta.get('commit_sha', ''))[:7]} ({self.ret.name}{', re-indexed' if reindexed else ', up to date'})")
                profile = company_profile(manifest, t)
                for doc in fresh:
                    await self.process(doc, profile)
                for k in ("extract", "retrieve", "analyze", "gate", "memo", "review"):
                    if next(s for s in self.rec.steps if s.key == k).status == "pending":
                        self.step(k, "skipped")

            self.rec.status, self.rec.finished_at = "COMPLETED", now()
            self.db.save_scan(self.rec)
            audit.record(self.db, t.tenant_id, "SCAN_COMPLETED", scan_id=self.rec.id, new=self.rec.new_documents, skipped=self.rec.skipped_documents, mode=fetched.mode)
        except Exception as e:  # noqa: BLE001 — the scan record must always reach a terminal state
            log.error("scan %s failed: %s\n%s", self.rec.id, e, traceback.format_exc())
            self.rec.status, self.rec.finished_at, self.rec.error = "FAILED", now(), f"{type(e).__name__}: {str(e)[:300]}"
            for pk in self.rec.document_ids:
                d = self.db.get_document(pk, t.tenant_id)
                if d and d.status in RETRYABLE:
                    self.db.update_document(pk, status="FAILED", error=self.rec.error)
            for s in self.rec.steps:
                if s.status == "running":
                    s.status = "failed"
            self.db.save_scan(self.rec)
            audit.record(self.db, t.tenant_id, "SCAN_FAILED", scan_id=self.rec.id, error=self.rec.error)
        return self.rec

    # ---- detection / versioning (PRD §18) -----------------------------------------------
    def detect(self, d: RegulatoryDocument) -> ProcessedDocument | None:
        t = self.tenant
        seen = self.db.find_document(t.tenant_id, d.source, d.document_id, d.content_hash)
        if seen and not self.force and seen.status not in RETRYABLE:
            audit.record(self.db, t.tenant_id, "DOCUMENT_SKIPPED", scan_id=self.rec.id, document_pk=seen.id, reason="same document id and content hash")
            return None
        if seen:
            # forced re-run, or a previous attempt never reached a terminal state: reset the row, never duplicate it
            self.db.update_document(seen.id, status="DISCOVERED", impact=None, analysis_id=None, error=None, processed_at=now().isoformat())
            audit.record(self.db, t.tenant_id, "DOCUMENT_DETECTED", scan_id=self.rec.id, document_pk=seen.id, forced=self.force, retry=seen.status in RETRYABLE)
            return self.db.get_document(seen.id, t.tenant_id)
        prev = self.db.latest_version(t.tenant_id, d.source, d.document_id)
        rec = ProcessedDocument(
            id=new_id("doc"), tenant_id=t.tenant_id, source=d.source, jurisdiction=d.jurisdiction, document_id=d.document_id,
            circular_number=d.circular_number, title=d.title, published_date=str(d.published_date) if d.published_date else None,
            effective_date=str(d.effective_date) if d.effective_date else None, url=d.url, content_hash=d.content_hash,
            document_version=(prev.document_version + 1) if prev else 1, previous_hash=prev.content_hash if prev else None,
            processed_at=now(), status="DISCOVERED", source_mode=d.source_mode,
        )
        self.db.insert_document(rec, d.content)
        audit.record(self.db, t.tenant_id, "DOCUMENT_VERSION_DETECTED" if prev else "DOCUMENT_DETECTED", scan_id=self.rec.id, document_pk=rec.id,
                     circular=d.circular_number, hash=d.content_hash[:12], version=rec.document_version, mode=d.source_mode)
        return rec

    # ---- per-document pipeline ------------------------------------------------------------
    async def process(self, doc: ProcessedDocument, profile: str) -> None:
        t, db = self.tenant, self.db
        analysis = AnalysisRecord(id=new_id("ana"), tenant_id=t.tenant_id, document_pk=doc.id, scan_id=self.rec.id, extraction={}, retrieved_chunks=[],
                                  impact=None, gate_outcome=None, memo=None, ai_provider=self.llm.name, models={}, metrics={}, created_at=now())
        try:
            reg = RegulatoryDocument(source=doc.source, jurisdiction=doc.jurisdiction, document_id=doc.document_id, circular_number=doc.circular_number,
                                     title=doc.title, url=doc.url, content=db.document_content(doc.id), content_hash=doc.content_hash,
                                     published_date=doc.published_date, effective_date=doc.effective_date)  # type: ignore[arg-type]
            # 1. extract
            db.update_document(doc.id, status="EXTRACTING", analysis_id=analysis.id)
            self.step("extract", "running", doc.title[:80])
            extraction, res = await extract_obligations(self.llm, reg)
            analysis.extraction, analysis.models["extraction"], analysis.metrics["extraction"] = extraction.model_dump(), res.model, self._llm(res)
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "OBLIGATIONS_EXTRACTED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id,
                         count=len(extraction.obligations), model=res.model)
            self.step("extract", "done", f"{len(extraction.obligations)} obligation(s) from {doc.circular_number or doc.document_id}")

            # 2. retrieve (hybrid, targeted chunks only — never the whole corpus)
            db.update_document(doc.id, status="RETRIEVING")
            self.step("retrieve", "running")
            query = " ".join([extraction.summary, *(o.requirement for o in extraction.obligations[:6])])[:2000]
            vec = await self.llm.embed([query])
            chunks = await self.ret.search(t.tenant_id, query, vec[0] if vec else None, k=6)
            analysis.retrieved_chunks = [c.model_dump() for c in chunks]
            analysis.metrics["retrieval"] = {"backend": self.ret.name, "count": len(chunks), "vector": bool(vec)}
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "POLICIES_RETRIEVED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id,
                         chunks=[c.chunk_id for c in chunks], backend=self.ret.name)
            self.step("retrieve", "done", ", ".join(dict.fromkeys(c.doc_id for c in chunks)) or "no matches")

            # 3. gate (cheap pass) → analyze (expensive) → gate (route)
            db.update_document(doc.id, status="ANALYZING")
            self.step("analyze", "running")
            run_full, why = cheap_prefilter(extraction, chunks)
            analysis.metrics["gate_prefilter"] = {"full_analysis": run_full, "reason": why}
            if run_full:
                impact, res = await analyze_impact(self.llm, extraction, chunks, profile, document_id=doc.document_id)
                analysis.impact, analysis.models["impact"], analysis.metrics["impact"] = impact.model_dump(), res.model, self._llm(res)
                outcome, reason = route(impact)
                audit.record(db, t.tenant_id, "IMPACT_ANALYZED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id,
                             applicability=impact.applicability, alignment=impact.alignment, confidence=impact.confidence, model=res.model)
                self.step("analyze", "done", f"applicability {impact.applicability}" + (f", {impact.alignment}" if impact.alignment else ""))
            else:
                outcome, reason = "ARCHIVED", why
                self.step("analyze", "skipped", f"gate: {why} — no model call spent")
            analysis.gate_outcome = outcome
            db.save_analysis(analysis)
            self.step("gate", "done", f"{outcome}: {reason}")

            if outcome == "CONFLICT":
                audit.record(db, t.tenant_id, "CONFLICT_DETECTED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=reason)
                db.update_document(doc.id, status="DRAFTING", impact="CONFLICT")
                self.step("memo", "running")
                memo, res = await generate_memo(self.llm, extraction, impact, chunks, document_id=doc.document_id)
                analysis.memo, analysis.models["memo"], analysis.metrics["memo"] = memo.model_dump(), res.model, self._llm(res)
                db.save_analysis(analysis)
                audit.record(db, t.tenant_id, "MEMO_GENERATED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, model=res.model)
                self.step("memo", "done", "AI-generated draft — human review required")
                self.request_review(doc, analysis)
            elif outcome == "ALIGNED":
                db.update_document(doc.id, status="ARCHIVED", impact="ALIGNED")
                audit.record(db, t.tenant_id, "ARCHIVED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=reason)
            elif outcome == "ARCHIVED":
                db.update_document(doc.id, status="ARCHIVED", impact="NOT_APPLICABLE")
                audit.record(db, t.tenant_id, "ARCHIVED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=reason)
            else:
                db.update_document(doc.id, status="NEEDS_INVESTIGATION", impact="UNCERTAIN")
                audit.record(db, t.tenant_id, "NEEDS_INVESTIGATION", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=reason)
        except Exception as e:  # noqa: BLE001 — one document failing must not stop the others
            log.error("document %s failed: %s\n%s", doc.id, e, traceback.format_exc())
            err = f"{type(e).__name__}: {str(e)[:300]}"
            db.update_document(doc.id, status="FAILED", error=err)
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "PIPELINE_FAILED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, error=err)
            for s in self.rec.steps:
                if s.status == "running":
                    self.step(s.key, "failed", err)

    def request_review(self, doc: ProcessedDocument, analysis: AnalysisRecord) -> ReviewRecord:
        existing = self.db.review_for_document(doc.id)
        if existing and existing.status == "APPROVED" and existing.ticket_id:
            # idempotency: an approved + ticketed review for this exact document is never re-opened
            self.db.update_document(doc.id, status="COMPLETED", ticket_id=existing.ticket_id, ticket_url=existing.ticket_url)
            self.step("review", "skipped", f"ticket #{existing.ticket_id} already exists")
            return existing
        rev = ReviewRecord(id=existing.id if existing else new_id("rev"), tenant_id=self.tenant.tenant_id, document_pk=doc.id, analysis_id=analysis.id,
                           status="AWAITING_REVIEW", requested_at=now())
        self.db.upsert_review(rev)
        self.db.update_document(doc.id, status="AWAITING_REVIEW")
        audit.record(self.db, self.tenant.tenant_id, "REVIEW_REQUESTED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, review_id=rev.id)
        self.step("review", "done", "awaiting human approval")
        return rev

