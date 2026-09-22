"""The scan pipeline: fetch → detect → extract → retrieve → analyze → gate → memo → review request.

Deterministic code owns state transitions, persistence, idempotency and audit. Models only understand, extract,
reason and draft. Nothing here executes a side effect; approval (services/reviews.py) does that.
"""

import logging
import time
import traceback

import httpx
from typing import Any

from app.agents.memo_generation import generate_memo
from app.agents.obligation_extraction import extract_obligations
from app.config import settings
from app.connectors.sebi import SEBIConnector
from app.models.provider import BudgetExceeded, CallBudget, LLMProvider, LLMResult, ProviderError, budget_var, provider
from app.retrieval.azure_search import retriever as make_retriever
from app.retrieval.base import Retriever
from app.schemas.actions import AnalysisRecord, ErrorKind, ProcessedDocument, ReviewRecord, ScanRecord, ScanStep, TenantContext
from app.schemas.impact import ImpactAnalysis, RegulatoryEvidence
from app.decisions.triage import addressee_block
from app.schemas.regulatory import RegulatoryDocument
from app.services import audit
from app.decisions.impact import ImpactDecision, decide_impact
from app.decisions.triage import prefilter, triage
from app.services.gate import route
from app.services.policies import RepositoryError, company_profile, ensure_indexed
from app.services.state import StateStore, new_id, now
from app.tools.github import GitHubClient, GitHubError

log = logging.getLogger(__name__)

# statuses a document can be re-processed from on the next scan (it never reached a decision)
RETRYABLE = {"DISCOVERED", "EXTRACTING", "RETRIEVING", "ANALYZING", "DRAFTING", "FAILED"}

STEPS = [
    ("connect", "Connecting to SEBI"),
    ("fetch", "Fetching publications"),
    ("detect", "Checking processed documents"),
    ("index", "Indexing internal policies"),
    ("triage", "Triaging relevance"),
    ("extract", "Extracting obligations"),
    ("retrieve", "Searching internal policies"),
    ("analyze", "Analyzing impact"),
    ("gate", "Running Impact Gate"),
    ("memo", "Drafting memo"),
    ("review", "Requesting human review"),
]


def friendly_error(e: BaseException) -> tuple[str, ErrorKind, str]:
    """(message for a person, kind, technical detail). Secrets never appear in exception text by construction."""
    detail = f"{type(e).__name__}: {str(e)[:300]}"
    if isinstance(e, RepositoryError):
        return str(e), "repository", detail
    if isinstance(e, GitHubError):
        return "AfterCircular could not access the configured policy repository.", "repository", detail
    if isinstance(e, BudgetExceeded):
        what = {"BUDGET_EXCEEDED:calls": "its model-call budget (AFTERCIRCULAR_MAX_LLM_CALLS_PER_SCAN)",
                "BUDGET_EXCEEDED:scan_cost": "its estimated-cost budget for one scan (AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_SCAN_USD)",
                "BUDGET_EXCEEDED:daily_cost": "the estimated daily spend limit (AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_DAY_USD)"}.get(e.reason, "a budget")
        return f"The scan stopped at {what}. Check the calls it made before raising the limit.", "ai", detail
    if isinstance(e, ProviderError):
        return "The AI provider did not respond. Check the model configuration and try again.", "ai", detail
    if isinstance(e, SourceUnavailable):
        return f"SEBI connection failed: {e}. No snapshot fallback in live mode.", "source", detail
    if isinstance(e, (httpx.HTTPError, ValueError)):
        return "The regulatory source could not be read.", "source", detail
    return "The scan stopped unexpectedly.", "backend", detail


class SourceUnavailable(RuntimeError):
    """Live regulatory source failed and the mode forbids a fallback."""


def provenance(doc: ProcessedDocument, impact: ImpactAnalysis, tenant: TenantContext, manifest: dict[str, Any]) -> dict[str, Any]:
    """Citable sources stored next to the impact: the exact official page/PDF for the regulation and the exact GitHub file
    for every policy clause cited. Kept outside the Foundry output schema (strict) — code attaches it, the model never does."""
    paths = {d["id"]: d["path"] for d in manifest.get("documents", []) if d.get("id") and d.get("path")}
    policy_sources = {}
    for e in impact.policy_evidence:
        path = paths.get(e.doc_id)
        policy_sources[e.doc_id] = {"path": path, "url": f"https://github.com/{tenant.github_repo}/blob/{tenant.default_branch}/{path}" if path else None,
                                    "repo": tenant.github_repo, "branch": tenant.default_branch, "fictional": True}
    return {"regulatory_source": {"regulator": doc.source, "source_mode": doc.source_mode, "synthetic": doc.synthetic, "title": doc.title, "reference": doc.circular_number,
                                  "published_date": doc.published_date, "detail_url": doc.url, "pdf_url": doc.document_url, "document_id": doc.document_id,
                                  "content_hash": doc.content_hash, "fetched_at": doc.fetched_at.isoformat() if doc.fetched_at else None},
            "policy_sources": policy_sources}


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

    def _llm(self, res: LLMResult, ok: bool = True, error: str | None = None, analysis_id: str | None = None) -> dict[str, Any]:
        self.db.record_llm_call(tenant_id=self.tenant.tenant_id, scan_id=self.rec.id, analysis_id=analysis_id, task=res.task, model=res.model, provider=res.provider,
                                latency_ms=res.latency_ms, input_tokens=res.input_tokens, output_tokens=res.output_tokens, cached_tokens=res.cached_tokens,
                                attempts=res.attempts, estimated_cost_usd=res.estimated_cost_usd, context_format=res.context_format,
                                structured_mode=res.structured_mode, pricing_status=res.pricing_status, response_id=res.response_id, ok=int(ok), error=error)
        self.rec.llm_calls += 1
        if res.estimated_cost_usd is not None:
            self.rec.estimated_cost_usd = round(self.rec.estimated_cost_usd + res.estimated_cost_usd, 6)
        log.info("llm_call task=%s model=%s provider=%s latency_ms=%s in=%s out=%s cached=%s cost_usd=%s format=%s mode=%s attempts=%s",
                 res.task, res.model, res.provider, res.latency_ms, res.input_tokens, res.output_tokens, res.cached_tokens, res.estimated_cost_usd,
                 res.context_format, res.structured_mode, res.attempts)
        return {"model": res.model, "latency_ms": res.latency_ms, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
                "cached_tokens": res.cached_tokens, "attempts": res.attempts, "estimated_cost_usd": res.estimated_cost_usd,
                "context_format": res.context_format, "structured_mode": res.structured_mode, "response_id": res.response_id}

    # ---- run ---------------------------------------------------------------------------
    async def run(self) -> ScanRecord:
        t = self.tenant
        cfg = settings()
        day_start = now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        spent_today = self.db.estimated_cost_since(day_start)  # application-wide: the daily breaker covers every tenant
        self.budget = CallBudget(cfg.max_llm_calls_per_scan, cfg.max_estimated_cost_per_scan_usd, cfg.max_estimated_cost_per_day_usd, spent_today)
        budget_var.set(self.budget)  # every generative call in this task tree draws from it
        audit.record(self.db, t.tenant_id, "SCAN_STARTED", actor=t.actor, actor_type="human", scan_id=self.rec.id, force=self.force,
                     max_documents=cfg.max_documents_per_scan, max_llm_calls=cfg.max_llm_calls_per_scan,
                     max_scan_cost_usd=cfg.max_estimated_cost_per_scan_usd, max_daily_cost_usd=cfg.max_estimated_cost_per_day_usd, spent_today_usd=round(spent_today, 4))
        try:
            if cfg.max_estimated_cost_per_day_usd and spent_today >= cfg.max_estimated_cost_per_day_usd:
                raise BudgetExceeded("BUDGET_EXCEEDED:daily_cost", f"estimated spend today ${spent_today:.4f} reached the ${cfg.max_estimated_cost_per_day_usd:.2f} daily limit; no generative calls made")
            self.step("connect", "running")
            fetched = await SEBIConnector().fetch_documents(settings().sebi_max_documents)
            self.rec.source_mode, self.rec.source_status, self.rec.source_error = fetched.mode, fetched.status, fetched.error
            if fetched.status == "LIVE_FAILED":
                # live mode never substitutes fixtures: the scan fails visibly with the real reason
                raise SourceUnavailable(fetched.error or "SEBI connection failed")
            connect_detail = {
                "LIVE_SUCCESS": f"Connected to SEBI — {fetched.discovered} circulars listed at sebi.gov.in",
                "LIVE_PARTIAL": f"Connected to SEBI — {fetched.discovered} listed, {len(fetched.warnings)} could not be retrieved",
                "DEMO_SNAPSHOT": "Demo snapshot — fictional publications, not SEBI data",
                "DEMO_SNAPSHOT_FALLBACK": f"Live SEBI fetch FAILED ({fetched.error}); fell back to the fictional demo snapshot",
            }.get(fetched.status, fetched.status)
            self.step("connect", "done", connect_detail)
            self.step("fetch", "done", f"{len(fetched.documents)} publication(s)" + (f"; {len(fetched.warnings)} warning(s)" if fetched.warnings else ""))

            self.step("detect", "running")
            # bounded scan: at most MAX_DOCUMENTS_PER_SCAN new documents are recorded and processed; the rest are not
            # inserted at all, so the next scan sees them again (no half-processed rows, no wasted model calls)
            fresh: list[ProcessedDocument] = []
            deferred = 0
            for d in fetched.documents:
                if len(fresh) >= cfg.max_documents_per_scan:
                    if not self.db.find_document(t.tenant_id, d.source, d.document_id, d.content_hash):
                        deferred += 1
                    continue
                detected = self.detect(d)
                if detected is not None:
                    fresh.append(detected)
            self.rec.new_documents, self.rec.skipped_documents, self.rec.deferred_documents = len(fresh), len(fetched.documents) - len(fresh) - deferred, deferred
            if fetched.status == "LIVE_SUCCESS" and not fresh and not deferred:
                self.rec.source_status = "LIVE_NO_NEW_DOCUMENTS"
            self.rec.document_ids = [d.id for d in fresh]
            self.step("detect", "done", f"{len(fresh)} new, {self.rec.skipped_documents} already processed" + (f", {deferred} deferred to the next scan (limit {cfg.max_documents_per_scan})" if deferred else ""))

            # the policy index tracks the repository head on every scan (PRD §8A), new circulars or not
            self.step("index", "running")
            gh = GitHubClient(t.github_token)
            manifest, reindexed = await ensure_indexed(self.db, gh, t, self.ret, self.llm.embed)
            meta = self.db.policy_index_meta(t.tenant_id) or {}
            if reindexed:
                audit.record(self.db, t.tenant_id, "POLICIES_INDEXED", scan_id=self.rec.id, repo=t.github_repo, commit=meta.get("commit_sha"), chunks=meta.get("chunk_count"), backend=self.ret.name)
            self.step("index", "done", f"{meta.get('chunk_count', 0)} chunks from {t.github_repo}@{str(meta.get('commit_sha', ''))[:7]} ({self.ret.name}{', re-indexed' if reindexed else ', up to date'})")

            if not fresh:
                for k in ("triage", "extract", "retrieve", "analyze", "gate", "memo", "review"):
                    self.step(k, "skipped", "nothing new")
            else:
                profile = company_profile(manifest, t)
                for doc in fresh:
                    await self.process(doc, profile, manifest)
                for k in ("triage", "extract", "retrieve", "analyze", "gate", "memo", "review"):
                    if next(s for s in self.rec.steps if s.key == k).status == "pending":
                        self.step(k, "skipped")

            self.rec.status, self.rec.finished_at = "COMPLETED", now()
            self.db.save_scan(self.rec)
            audit.record(self.db, t.tenant_id, "SCAN_COMPLETED", scan_id=self.rec.id, new=self.rec.new_documents, skipped=self.rec.skipped_documents,
                         deferred=self.rec.deferred_documents, mode=fetched.mode, source_status=self.rec.source_status, llm_calls=self.rec.llm_calls)
        except Exception as e:  # noqa: BLE001 — the scan record must always reach a terminal state
            log.error("scan %s failed: %s\n%s", self.rec.id, e, traceback.format_exc())
            self.rec.status, self.rec.finished_at = "FAILED", now()
            self.rec.error, self.rec.error_kind, self.rec.error_detail = friendly_error(e)
            for pk in self.rec.document_ids:
                pd = self.db.get_document(pk, t.tenant_id)
                if pd and pd.status in RETRYABLE:
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
            processed_at=now(), status="DISCOVERED", source_mode=d.source_mode, synthetic=d.synthetic, document_url=d.document_url, fetched_at=d.fetched_at,
        )
        self.db.insert_document(rec, d.content)
        audit.record(self.db, t.tenant_id, "DOCUMENT_VERSION_DETECTED" if prev else "DOCUMENT_DETECTED", scan_id=self.rec.id, document_pk=rec.id,
                     circular=d.circular_number, hash=d.content_hash[:12], version=rec.document_version, mode=d.source_mode)
        return rec

    # ---- per-document pipeline ------------------------------------------------------------
    async def process(self, doc: ProcessedDocument, profile: str, manifest: dict[str, Any]) -> None:
        t, db = self.tenant, self.db
        analysis = AnalysisRecord(id=new_id("ana"), tenant_id=t.tenant_id, document_pk=doc.id, scan_id=self.rec.id, extraction={}, retrieved_chunks=[],
                                  impact=None, gate_outcome=None, memo=None, ai_provider=self.llm.name, models={}, metrics={}, created_at=now())
        try:
            reg = RegulatoryDocument(source=doc.source, jurisdiction=doc.jurisdiction, document_id=doc.document_id, circular_number=doc.circular_number,
                                     title=doc.title, url=doc.url, content=db.document_content(doc.id), content_hash=doc.content_hash,
                                     published_date=doc.published_date, effective_date=doc.effective_date)  # type: ignore[arg-type]
            # 0. triage: free prefilter, then one Jev request on the header — no Foundry call for circulars that
            #    plainly concern other entity types. Uncertain always proceeds (spending extraction is the safe direction).
            db.update_document(doc.id, status="EXTRACTING", analysis_id=analysis.id)
            self.step("triage", "running", doc.title[:80])
            pre = prefilter(reg, manifest)
            tri = pre
            if pre.outcome == "proceed":
                tdec = ImpactDecision(analysis.id, t.tenant_id, doc.document_id)
                tri = await triage(tdec, reg, manifest, t.company_name, pre)
                db.save_decisions(tdec.records)
                analysis.decision_path = list(tdec.path)
            analysis.metrics["triage"] = {"stage": tri.stage, "outcome": tri.outcome, "confidence": tri.confidence, "addressees": tri.addressees, "entity_match": tri.entity_match}
            if tri.outcome == "archive":
                impact = ImpactAnalysis(applicability="NO", reason=f"Archived at triage ({tri.stage}): {tri.reason}",
                                        regulatory_evidence=[RegulatoryEvidence(section="header", text=addressee_block(reg.content)[:300] or reg.title)],
                                        effective_date=str(doc.effective_date) if doc.effective_date else None, confidence=tri.confidence or 1.0)
                analysis.impact, analysis.gate_outcome = {**impact.model_dump(), **provenance(doc, impact, t, manifest)}, "ARCHIVED"
                db.save_analysis(analysis)
                db.update_document(doc.id, status="ARCHIVED", impact="NOT_APPLICABLE")
                audit.record(db, t.tenant_id, "IMPACT_ANALYZED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, applicability="NO",
                             alignment=None, confidence=impact.confidence, path=analysis.decision_path, escalation=None, severity=None, triage=tri.stage)
                audit.record(db, t.tenant_id, "ARCHIVED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=impact.reason)
                self.step("triage", "done", f"not applicable — {tri.reason[:90]} (no extraction call)")
                for k in ("extract", "retrieve", "analyze", "memo", "review"):
                    self.step(k, "skipped", "archived at triage")
                self.step("gate", "done", "ARCHIVED: not applicable (triage)")
                return
            self.step("triage", "done", tri.reason[:100])

            # 1. extract
            self.step("extract", "running", doc.title[:80])
            extraction, res = await extract_obligations(self.llm, reg)
            analysis.extraction, analysis.models["extraction"], analysis.metrics["extraction"] = extraction.model_dump(), res.model, self._llm(res, analysis_id=analysis.id)
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "OBLIGATIONS_EXTRACTED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id,
                         count=len(extraction.obligations), model=res.model)
            self.step("extract", "done", f"{len(extraction.obligations)} obligation(s) from {doc.circular_number or doc.document_id}")

            # 2. retrieve (hybrid, targeted chunks only — never the whole corpus)
            db.update_document(doc.id, status="RETRIEVING")
            self.step("retrieve", "running")
            query = " ".join([extraction.summary, *(o.requirement for o in extraction.obligations[:6])])[:2000]
            t_embed = time.perf_counter()
            vec = await self.llm.embed([query])
            t_search = time.perf_counter()
            chunks = await self.ret.search(t.tenant_id, query, vec[0] if vec else None, k=10)
            analysis.retrieved_chunks = [c.model_dump() for c in chunks]
            analysis.metrics["retrieval"] = {"backend": self.ret.name, "count": len(chunks), "vector": bool(vec), "query": query, "k": 10,
                                             "method": "hybrid (BM25 + vector, RRF)" if vec else "keyword (BM25)", "embedding_model": settings().embedding_model if vec else None,
                                             "embed_ms": int((t_search - t_embed) * 1000), "search_ms": int((time.perf_counter() - t_search) * 1000), "at": now().isoformat(),
                                             "commits": sorted({c.commit_sha for c in chunks if c.commit_sha})}
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "POLICIES_RETRIEVED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id,
                         chunks=[c.chunk_id for c in chunks], backend=self.ret.name)
            self.step("retrieve", "done", ", ".join(dict.fromkeys(c.doc_id for c in chunks)) or "no matches")

            # 3. decide: typed judgments (Jev) → deterministic routing → reasoning-model escalation → gate
            db.update_document(doc.id, status="ANALYZING")
            self.step("analyze", "running")
            if not extraction.obligations:
                outcome, reason = "ARCHIVED", "No obligations extracted — nothing to compare"
                analysis.impact = None
                self.step("analyze", "skipped", reason)
            else:
                decision = await decide_impact(analysis_id=analysis.id, tenant_id=t.tenant_id, document_id=doc.document_id, extraction=extraction,
                                               circular_text=reg.content, candidates=chunks, manifest=manifest, company_name=t.company_name, profile=profile, llm=self.llm,
                                               triage_confidence=tri.confidence if tri.outcome != "skipped" else 0.0,
                                               path_prefix=analysis.decision_path)
                impact = decision.impact or ImpactAnalysis(applicability="UNCERTAIN", reason="decision layer returned nothing", confidence=0.0)
                for res in decision.llm_results:
                    analysis.models["impact"], analysis.metrics["impact"] = res.model, self._llm(res, analysis_id=analysis.id)
                db.save_decisions(decision.records)
                analysis.impact, analysis.decision_path, analysis.escalation_reason = {**impact.model_dump(), **provenance(doc, impact, t, manifest)}, decision.path, decision.escalation_reason
                analysis.metrics["decisions"] = {"records": len(decision.records), "judges": sorted({r.provider for r in decision.records if r.provider != "code"}),
                                                 "kept_chunks": [c.chunk_id for c in decision.kept_chunks], "obligations_verified": len(decision.obligations)}
                chunks = decision.kept_chunks or chunks
                outcome, reason = route(impact)
                audit.record(db, t.tenant_id, "IMPACT_ANALYZED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id,
                             applicability=impact.applicability, alignment=impact.alignment, confidence=impact.confidence,
                             path=decision.path, escalation=decision.escalation_reason, severity=impact.severity)
                self.step("analyze", "done", f"applicability {impact.applicability}" + (f", {impact.alignment}" if impact.alignment else "") + f" via {' → '.join(decision.path)}")
            analysis.gate_outcome = outcome
            db.save_analysis(analysis)
            self.step("gate", "done", f"{outcome}: {reason}")

            if outcome == "CONFLICT":
                audit.record(db, t.tenant_id, "CONFLICT_DETECTED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=reason)
                db.update_document(doc.id, status="DRAFTING", impact="CONFLICT")
                self.step("memo", "running")
                memo, res = await generate_memo(self.llm, extraction, impact, chunks, document_id=doc.document_id)
                analysis.memo, analysis.models["memo"], analysis.metrics["memo"] = memo.model_dump(), res.model, self._llm(res, analysis_id=analysis.id)
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
        except BudgetExceeded as e:
            # no side effect was executed (memo/review only follow a completed decision); the document is retryable next scan
            log.warning("document %s stopped: %s", doc.id, e)
            db.update_document(doc.id, status="FAILED", error=str(e)[:300])
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "BUDGET_EXCEEDED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, reason=e.reason,
                         detail=str(e)[:300], calls=self.budget.used, estimated_cost_usd=round(self.budget.spent, 6))
            for s in self.rec.steps:
                if s.status == "running":
                    self.step(s.key, "failed", e.reason)
            raise
        except Exception as e:  # noqa: BLE001 — one document failing must not stop the others
            log.error("document %s failed: %s\n%s", doc.id, e, traceback.format_exc())
            err = f"{type(e).__name__}: {str(e)[:300]}"
            db.update_document(doc.id, status="FAILED", error=err)
            db.save_analysis(analysis)
            audit.record(db, t.tenant_id, "PIPELINE_FAILED", scan_id=self.rec.id, document_pk=doc.id, analysis_id=analysis.id, error=err)
            if isinstance(e, ProviderError):  # the failed model call is telemetry too: it shows up in the usage error count, never as a result
                task = {"extract": "extraction", "analyze": "impact", "memo": "memo"}.get(next((s.key for s in self.rec.steps if s.status == "running"), ""), "unknown")
                db.record_llm_call(tenant_id=t.tenant_id, scan_id=self.rec.id, analysis_id=analysis.id, task=task, model=self.llm.model_for(task) if task != "unknown" else "-",
                                   provider=self.llm.name, latency_ms=0, input_tokens=None, output_tokens=None, ok=0, error=err[:300])
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

