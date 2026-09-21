"""Persistent state: SQLite behind a small repository class.

ponytail: SQLite + sync calls on the event loop (single-process demo). Swap `connect()` for
Azure PostgreSQL by keeping the same method signatures — nothing above this module touches SQL.
"""

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings
from app.schemas.decisions import DecisionRecord
from app.schemas.actions import (
    AnalysisRecord,
    Investigation,
    AuditEvent,
    ProcessedDocument,
    ReviewRecord,
    ScanRecord,
    ScanStep,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, github_repo TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main', connected_by TEXT, connected_by_login TEXT, connected_at TEXT
);
CREATE INDEX IF NOT EXISTS tenants_owner ON tenants(connected_by);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL, source_mode TEXT,
  started_at TEXT NOT NULL, finished_at TEXT, steps TEXT NOT NULL, new_documents INTEGER DEFAULT 0,
  skipped_documents INTEGER DEFAULT 0, document_ids TEXT NOT NULL DEFAULT '[]', error TEXT,
  ai_provider TEXT DEFAULT '', retrieval_backend TEXT DEFAULT '', error_kind TEXT, error_detail TEXT
);
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, question TEXT NOT NULL, intent TEXT NOT NULL, summary TEXT NOT NULL,
  document_pk TEXT, analysis_id TEXT, policy_id TEXT, answer TEXT NOT NULL, judge TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_documents (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source TEXT NOT NULL, jurisdiction TEXT NOT NULL,
  document_id TEXT NOT NULL, circular_number TEXT, title TEXT NOT NULL, published_date TEXT, effective_date TEXT,
  url TEXT NOT NULL, content_hash TEXT NOT NULL, document_version INTEGER NOT NULL DEFAULT 1, previous_hash TEXT,
  processed_at TEXT NOT NULL, status TEXT NOT NULL, impact TEXT, analysis_id TEXT, ticket_id TEXT, ticket_url TEXT,
  source_mode TEXT NOT NULL DEFAULT 'LIVE', error TEXT, content TEXT NOT NULL DEFAULT '',
  UNIQUE(tenant_id, source, document_id, content_hash)
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, document_pk TEXT NOT NULL, scan_id TEXT,
  extraction TEXT NOT NULL, retrieved_chunks TEXT NOT NULL, impact TEXT, gate_outcome TEXT, memo TEXT,
  ai_provider TEXT NOT NULL, models TEXT NOT NULL, metrics TEXT NOT NULL, created_at TEXT NOT NULL,
  decision_path TEXT NOT NULL DEFAULT '[]', escalation_reason TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, tenant_id TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  calibrated INTEGER, question_ids TEXT NOT NULL, state_digest TEXT NOT NULL, evidence_ids TEXT NOT NULL, answers TEXT NOT NULL,
  routing TEXT NOT NULL, latency_ms INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_analysis ON decisions(analysis_id);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, document_pk TEXT NOT NULL UNIQUE, analysis_id TEXT NOT NULL,
  status TEXT NOT NULL, requested_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, note TEXT,
  ticket_id TEXT, ticket_url TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, timestamp TEXT NOT NULL, actor TEXT NOT NULL, actor_type TEXT NOT NULL,
  event_type TEXT NOT NULL, document_pk TEXT, analysis_id TEXT, scan_id TEXT, metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY, tenant_id TEXT, scan_id TEXT, task TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL,
  latency_ms INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, ok INTEGER NOT NULL, error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_chunks (
  chunk_id TEXT NOT NULL, tenant_id TEXT NOT NULL, doc_id TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL,
  version TEXT, section TEXT NOT NULL, text TEXT NOT NULL, embedding TEXT, PRIMARY KEY (tenant_id, chunk_id)
);
CREATE TABLE IF NOT EXISTS policy_index_meta (
  tenant_id TEXT PRIMARY KEY, repo TEXT NOT NULL, commit_sha TEXT NOT NULL, indexed_at TEXT NOT NULL, chunk_count INTEGER NOT NULL,
  documents TEXT NOT NULL DEFAULT '[]'
);
"""


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _j(v: Any) -> str:
    return json.dumps(v, default=str)


def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(r) if r else None


class StateStore:
    """One sqlite3 connection per thread: FastAPI runs sync endpoints in a threadpool while the scan runs on the
    event-loop thread, and a shared connection is not safe across threads (cursor state gets interleaved)."""

    def __init__(self, path: str | None = None):
        self.path = str(Path(path or settings().database_path))
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._memory_conn: sqlite3.Connection | None = None
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self._migrate()

    @property
    def conn(self) -> sqlite3.Connection:
        if self.path == ":memory:":  # tests: a single shared in-memory database
            if self._memory_conn is None:
                self._memory_conn = sqlite3.connect(self.path, check_same_thread=False)
                self._memory_conn.row_factory = sqlite3.Row
            return self._memory_conn
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA busy_timeout=30000")
            self._local.conn = c
        return c

    def _migrate(self) -> None:
        """Additive column migrations for existing dev databases (CREATE TABLE IF NOT EXISTS never alters)."""
        wanted = {
            "analyses": (("decision_path", "TEXT NOT NULL DEFAULT '[]'"), ("escalation_reason", "TEXT")),
            "scans": (("error_kind", "TEXT"), ("error_detail", "TEXT")),
            "policy_index_meta": (("documents", "TEXT NOT NULL DEFAULT '[]'"),),
        }
        for table, cols in wanted.items():
            have = {r["name"] for r in self.conn.execute(f"PRAGMA table_info({table})").fetchall()}
            for name, ddl in cols:
                if name not in have:
                    self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        self.conn.commit()

    # ---- tenants -----------------------------------------------------------------------
    def upsert_tenant(self, t: dict[str, Any]) -> dict[str, Any]:
        self.conn.execute(
            """INSERT INTO tenants(tenant_id, company_name, github_repo, default_branch, connected_by, connected_by_login, connected_at)
               VALUES(:tenant_id,:company_name,:github_repo,:default_branch,:connected_by,:connected_by_login,:connected_at)
               ON CONFLICT(tenant_id) DO UPDATE SET company_name=excluded.company_name, github_repo=excluded.github_repo,
               default_branch=excluded.default_branch, connected_by=excluded.connected_by,
               connected_by_login=excluded.connected_by_login, connected_at=excluded.connected_at""",
            {"default_branch": "main", "connected_by": None, "connected_by_login": None, "connected_at": None, **t},
        )
        self.conn.commit()
        return t

    def tenant_by_owner(self, github_id: str) -> dict[str, Any] | None:
        return _row(self.conn.execute("SELECT * FROM tenants WHERE connected_by=? ORDER BY connected_at DESC", (github_id,)).fetchone())

    def tenants_by_owner(self, github_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM tenants WHERE connected_by=? ORDER BY connected_at DESC", (github_id,)).fetchall()
        return [r for r in (_row(x) for x in rows) if r]

    # ---- scans -------------------------------------------------------------------------
    def create_scan(self, tenant_id: str, steps: list[ScanStep], ai_provider: str, retrieval_backend: str) -> ScanRecord:
        rec = ScanRecord(id=new_id("scan"), tenant_id=tenant_id, status="RUNNING", started_at=now(), steps=steps,
                         ai_provider=ai_provider, retrieval_backend=retrieval_backend)
        self.conn.execute(
            "INSERT INTO scans(id, tenant_id, status, started_at, steps, ai_provider, retrieval_backend) VALUES(?,?,?,?,?,?,?)",
            (rec.id, tenant_id, rec.status, rec.started_at.isoformat(), _j([s.model_dump() for s in steps]), ai_provider, retrieval_backend),
        )
        self.conn.commit()
        return rec

    def save_scan(self, rec: ScanRecord) -> None:
        self.conn.execute(
            """UPDATE scans SET status=?, source_mode=?, finished_at=?, steps=?, new_documents=?, skipped_documents=?, document_ids=?, error=?, error_kind=?, error_detail=? WHERE id=?""",
            (rec.status, rec.source_mode, rec.finished_at.isoformat() if rec.finished_at else None,
             _j([s.model_dump() for s in rec.steps]), rec.new_documents, rec.skipped_documents, _j(rec.document_ids), rec.error, rec.error_kind, rec.error_detail, rec.id),
        )
        self.conn.commit()

    def get_scan(self, scan_id: str, tenant_id: str) -> ScanRecord | None:
        r = _row(self.conn.execute("SELECT * FROM scans WHERE id=? AND tenant_id=?", (scan_id, tenant_id)).fetchone())
        return self._scan(r) if r else None

    def latest_scan(self, tenant_id: str) -> ScanRecord | None:
        r = _row(self.conn.execute("SELECT * FROM scans WHERE tenant_id=? ORDER BY started_at DESC LIMIT 1", (tenant_id,)).fetchone())
        return self._scan(r) if r else None

    def running_scan(self, tenant_id: str) -> ScanRecord | None:
        r = _row(self.conn.execute("SELECT * FROM scans WHERE tenant_id=? AND status='RUNNING' ORDER BY started_at DESC LIMIT 1", (tenant_id,)).fetchone())
        return self._scan(r) if r else None

    @staticmethod
    def _scan(r: dict[str, Any]) -> ScanRecord:
        r["steps"] = json.loads(r["steps"])
        r["document_ids"] = json.loads(r["document_ids"])
        return ScanRecord.model_validate(r)

    # ---- processed documents -----------------------------------------------------------
    def find_document(self, tenant_id: str, source: str, document_id: str, content_hash: str) -> ProcessedDocument | None:
        r = _row(self.conn.execute(
            "SELECT * FROM processed_documents WHERE tenant_id=? AND source=? AND document_id=? AND content_hash=?",
            (tenant_id, source, document_id, content_hash)).fetchone())
        return ProcessedDocument.model_validate(r) if r else None

    def latest_version(self, tenant_id: str, source: str, document_id: str) -> ProcessedDocument | None:
        r = _row(self.conn.execute(
            "SELECT * FROM processed_documents WHERE tenant_id=? AND source=? AND document_id=? ORDER BY document_version DESC LIMIT 1",
            (tenant_id, source, document_id)).fetchone())
        return ProcessedDocument.model_validate(r) if r else None

    def insert_document(self, doc: ProcessedDocument, content: str) -> ProcessedDocument:
        d = doc.model_dump()
        d["processed_at"] = doc.processed_at.isoformat()
        d["content"] = content
        cols = ", ".join(d)
        self.conn.execute(f"INSERT INTO processed_documents({cols}) VALUES({', '.join(':' + c for c in d)})", d)
        self.conn.commit()
        return doc

    def update_document(self, pk: str, **fields: Any) -> None:
        sets = ", ".join(f"{k}=:{k}" for k in fields)
        self.conn.execute(f"UPDATE processed_documents SET {sets} WHERE id=:id", {**fields, "id": pk})
        self.conn.commit()

    def get_document(self, pk: str, tenant_id: str) -> ProcessedDocument | None:
        r = _row(self.conn.execute("SELECT * FROM processed_documents WHERE id=? AND tenant_id=?", (pk, tenant_id)).fetchone())
        return ProcessedDocument.model_validate(r) if r else None

    def document_content(self, pk: str) -> str:
        r = self.conn.execute("SELECT content FROM processed_documents WHERE id=?", (pk,)).fetchone()
        return r["content"] if r else ""

    def list_documents(self, tenant_id: str, limit: int = 50) -> list[ProcessedDocument]:
        rows = self.conn.execute(
            "SELECT * FROM processed_documents WHERE tenant_id=? ORDER BY processed_at DESC LIMIT ?", (tenant_id, limit)).fetchall()
        return [ProcessedDocument.model_validate(dict(r)) for r in rows]

    # ---- analyses ----------------------------------------------------------------------
    def save_analysis(self, a: AnalysisRecord) -> AnalysisRecord:
        self.conn.execute(
            """INSERT INTO analyses(id, tenant_id, document_pk, scan_id, extraction, retrieved_chunks, impact, gate_outcome, memo, ai_provider, models, metrics, created_at, decision_path, escalation_reason)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET extraction=excluded.extraction, retrieved_chunks=excluded.retrieved_chunks, impact=excluded.impact,
               gate_outcome=excluded.gate_outcome, memo=excluded.memo, models=excluded.models, metrics=excluded.metrics,
               decision_path=excluded.decision_path, escalation_reason=excluded.escalation_reason""",
            (a.id, a.tenant_id, a.document_pk, a.scan_id, _j(a.extraction), _j(a.retrieved_chunks), _j(a.impact) if a.impact is not None else None,
             a.gate_outcome, _j(a.memo) if a.memo is not None else None, a.ai_provider, _j(a.models), _j(a.metrics), a.created_at.isoformat(),
             _j(a.decision_path), a.escalation_reason),
        )
        self.conn.commit()
        return a

    def get_analysis(self, analysis_id: str, tenant_id: str) -> AnalysisRecord | None:
        r = _row(self.conn.execute("SELECT * FROM analyses WHERE id=? AND tenant_id=?", (analysis_id, tenant_id)).fetchone())
        if not r:
            return None
        for k in ("extraction", "retrieved_chunks", "impact", "memo", "models", "metrics", "decision_path"):
            r[k] = json.loads(r[k]) if r[k] is not None else None
        return AnalysisRecord.model_validate(r)

    # ---- decision records (typed judgments + routing) ----------------------------------
    def save_decisions(self, records: list[DecisionRecord]) -> None:
        self.conn.executemany(
            """INSERT OR REPLACE INTO decisions(id, analysis_id, tenant_id, stage, provider, model, calibrated, question_ids, state_digest, evidence_ids,
               answers, routing, latency_ms, input_tokens, output_tokens, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(r.id, r.analysis_id, r.tenant_id, r.stage, r.provider, r.model, None if r.calibrated is None else int(r.calibrated), _j(r.question_ids),
              r.state_digest, _j(r.evidence_ids), _j({k: v.model_dump(exclude_none=True) for k, v in r.answers.items()}), _j(r.routing), r.latency_ms,
              r.input_tokens, r.output_tokens, r.created_at.isoformat()) for r in records],
        )
        self.conn.commit()

    def decisions_for(self, analysis_id: str, tenant_id: str) -> list[DecisionRecord]:
        out = []
        for r in self.conn.execute("SELECT * FROM decisions WHERE analysis_id=? AND tenant_id=? ORDER BY created_at, rowid", (analysis_id, tenant_id)).fetchall():
            d = dict(r)
            for k in ("question_ids", "evidence_ids", "answers", "routing"):
                d[k] = json.loads(d[k])
            d["calibrated"] = None if d["calibrated"] is None else bool(d["calibrated"])
            out.append(DecisionRecord.model_validate(d))
        return out

    # ---- reviews -----------------------------------------------------------------------
    def upsert_review(self, rev: ReviewRecord) -> ReviewRecord:
        self.conn.execute(
            """INSERT INTO reviews(id, tenant_id, document_pk, analysis_id, status, requested_at, decided_at, decided_by, note, ticket_id, ticket_url)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(document_pk) DO UPDATE SET analysis_id=excluded.analysis_id, status=excluded.status, decided_at=excluded.decided_at,
               decided_by=excluded.decided_by, note=excluded.note, ticket_id=excluded.ticket_id, ticket_url=excluded.ticket_url""",
            (rev.id, rev.tenant_id, rev.document_pk, rev.analysis_id, rev.status, rev.requested_at.isoformat(),
             rev.decided_at.isoformat() if rev.decided_at else None, rev.decided_by, rev.note, rev.ticket_id, rev.ticket_url),
        )
        self.conn.commit()
        return rev

    def get_review(self, review_id: str, tenant_id: str) -> ReviewRecord | None:
        r = _row(self.conn.execute("SELECT * FROM reviews WHERE id=? AND tenant_id=?", (review_id, tenant_id)).fetchone())
        return ReviewRecord.model_validate(r) if r else None

    def review_for_document(self, document_pk: str) -> ReviewRecord | None:
        r = _row(self.conn.execute("SELECT * FROM reviews WHERE document_pk=?", (document_pk,)).fetchone())
        return ReviewRecord.model_validate(r) if r else None

    def list_reviews(self, tenant_id: str, status: str | None = None) -> list[ReviewRecord]:
        q: str = "SELECT * FROM reviews WHERE tenant_id=?"
        args: list[Any] = [tenant_id]
        if status:
            q, args = q + " AND status=?", args + [status]
        rows = self.conn.execute(q + " ORDER BY requested_at DESC", args).fetchall()
        return [ReviewRecord.model_validate(dict(r)) for r in rows]

    # ---- audit -------------------------------------------------------------------------
    def audit(self, ev: AuditEvent) -> AuditEvent:
        self.conn.execute(
            "INSERT INTO audit_events(id, tenant_id, timestamp, actor, actor_type, event_type, document_pk, analysis_id, scan_id, metadata) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (ev.id, ev.tenant_id, ev.timestamp.isoformat(), ev.actor, ev.actor_type, ev.event_type, ev.document_pk, ev.analysis_id, ev.scan_id, _j(ev.metadata)),
        )
        self.conn.commit()
        return ev

    def list_audit(self, tenant_id: str, limit: int = 100, document_pk: str | None = None) -> list[AuditEvent]:
        q: str = "SELECT * FROM audit_events WHERE tenant_id=?"
        args: list[Any] = [tenant_id]
        if document_pk:
            q, args = q + " AND document_pk=?", args + [document_pk]
        rows = self.conn.execute(q + " ORDER BY timestamp DESC LIMIT ?", args + [limit]).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["metadata"] = json.loads(d["metadata"])
            out.append(AuditEvent.model_validate(d))
        return out

    # ---- llm observability (PRD §21) ----------------------------------------------------
    def record_llm_call(self, **f: Any) -> None:
        f.setdefault("id", new_id("llm"))
        f.setdefault("created_at", now().isoformat())
        cols = ", ".join(f)
        self.conn.execute(f"INSERT INTO llm_calls({cols}) VALUES({', '.join(':' + c for c in f)})", f)
        self.conn.commit()

    def llm_calls_for_scan(self, scan_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM llm_calls WHERE scan_id=?", (scan_id,)).fetchall()]

    # ---- local policy index -------------------------------------------------------------
    def replace_policy_chunks(self, tenant_id: str, repo: str, commit_sha: str, chunks: list[dict[str, Any]], documents: list[dict[str, Any]] | None = None) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM policy_chunks WHERE tenant_id=?", (tenant_id,))
            self.conn.executemany(
                "INSERT INTO policy_chunks(chunk_id, tenant_id, doc_id, title, path, version, section, text, embedding) VALUES(?,?,?,?,?,?,?,?,?)",
                [(c["chunk_id"], tenant_id, c["doc_id"], c["title"], c["path"], c.get("version"), c["section"], c["text"],
                  _j(c["embedding"]) if c.get("embedding") is not None else None) for c in chunks],
            )
            self.conn.execute(
                "INSERT INTO policy_index_meta(tenant_id, repo, commit_sha, indexed_at, chunk_count, documents) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id) DO UPDATE SET repo=excluded.repo, commit_sha=excluded.commit_sha, indexed_at=excluded.indexed_at, chunk_count=excluded.chunk_count, documents=excluded.documents",
                (tenant_id, repo, commit_sha, now().isoformat(), len(chunks), _j(documents or [])),
            )

    def policy_index_meta(self, tenant_id: str) -> dict[str, Any] | None:
        r = _row(self.conn.execute("SELECT * FROM policy_index_meta WHERE tenant_id=?", (tenant_id,)).fetchone())
        if r:
            r["documents"] = json.loads(r.get("documents") or "[]")
        return r

    # ---- investigations (agent surface) --------------------------------------------------
    def save_investigation(self, inv: Investigation) -> Investigation:
        self.conn.execute(
            "INSERT INTO investigations(id, tenant_id, question, intent, summary, document_pk, analysis_id, policy_id, answer, judge, actor, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (inv.id, inv.tenant_id, inv.question, inv.intent, inv.summary, inv.document_pk, inv.analysis_id, inv.policy_id, _j(inv.answer), _j(inv.judge), inv.actor, inv.created_at.isoformat()),
        )
        self.conn.commit()
        return inv

    def get_investigation(self, inv_id: str, tenant_id: str) -> Investigation | None:
        r = _row(self.conn.execute("SELECT * FROM investigations WHERE id=? AND tenant_id=?", (inv_id, tenant_id)).fetchone())
        if not r:
            return None
        r["answer"], r["judge"] = json.loads(r["answer"]), json.loads(r["judge"])
        return Investigation.model_validate(r)

    def list_investigations(self, tenant_id: str, limit: int = 20) -> list[Investigation]:
        out = []
        for r in self.conn.execute("SELECT * FROM investigations WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?", (tenant_id, limit)).fetchall():
            d = dict(r)
            d["answer"], d["judge"] = json.loads(d["answer"]), json.loads(d["judge"])
            out.append(Investigation.model_validate(d))
        return out

    def policy_chunks(self, tenant_id: str) -> list[dict[str, Any]]:
        out = []
        for r in self.conn.execute("SELECT * FROM policy_chunks WHERE tenant_id=?", (tenant_id,)).fetchall():
            d = dict(r)
            d["embedding"] = json.loads(d["embedding"]) if d["embedding"] else None
            out.append(d)
        return out


_store: StateStore | None = None


def store() -> StateStore:
    global _store
    if _store is None:
        _store = StateStore()
    return _store
