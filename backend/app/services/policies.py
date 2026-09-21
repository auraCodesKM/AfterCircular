"""Policy corpus: GitHub repo (aftercircular.yml manifest + markdown docs) → front-matter metadata → section chunks."""

import hashlib
import re
from datetime import date, datetime, timezone
from typing import Any

import logging

import yaml

from app.schemas.actions import TenantContext
from app.services.state import StateStore
from app.tools.github import GitHubClient, GitHubError

log = logging.getLogger(__name__)

_FM = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
_HEADING = re.compile(r"^(#{2,3})\s+(.*)$", re.M)


def parse_front_matter(text: str) -> tuple[dict[str, Any], str]:
    m = _FM.match(text)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    return meta, text[m.end():]


def chunk_markdown(doc_id: str, title: str, path: str, version: str | None, body: str) -> list[dict[str, Any]]:
    """One chunk per `##`/`###` section, labelled with its section number (e.g. '4.1') for citations."""
    chunks = []
    positions = [(m.start(), m.end(), m.group(2).strip()) for m in _HEADING.finditer(body)]
    for i, (start, end, heading) in enumerate(positions):
        stop = positions[i + 1][0] if i + 1 < len(positions) else len(body)
        text = body[end:stop].strip()
        if len(text) < 20:
            continue
        num = re.match(r"^(\d+(?:\.\d+)*)\.?\s+(.*)", heading)
        section = num.group(1) if num else heading
        label = f"{section} {num.group(2)}" if num else heading
        full = f"{doc_id} — {title} §{label}\n{text}"
        chunks.append({
            "chunk_id": f"{doc_id}#{section}", "doc_id": doc_id, "title": title, "path": path, "version": version,
            "section": label, "text": full, "chunk_hash": chunk_hash(full),
        })
    return chunks


def chunk_hash(text: str) -> str:
    """Stable identity of a chunk's content: unchanged text is never re-embedded or re-uploaded."""
    return hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()[:24]


def edm_datetime(value: Any) -> str | None:
    """Front-matter date (YYYY-MM-DD, date, datetime) → Edm.DateTimeOffset text ('2025-04-01T00:00:00Z'); None stays None."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return f"{value.isoformat()}T00:00:00Z"
    s = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return f"{s}T00:00:00Z"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})", s):
        return s
    raise ValueError(f"effective_date {s!r} is not an ISO date")


def enrich_chunks(chunks: list[dict[str, Any]], docs: list[dict[str, Any]], manifest: dict[str, Any], commit_sha: str) -> None:
    """Attach the index metadata (docs/azure/policies-dev.index.json) to every chunk, in place."""
    company = manifest.get("company", {})
    by_doc = {d["doc_id"]: d for d in docs}
    for c in chunks:
        d = by_doc.get(c["doc_id"], {})
        c.update({
            "category": d.get("category"), "effective_date": edm_datetime(d.get("effective_date")), "status": "active",
            "regulator": company.get("regulator"), "jurisdiction": company.get("country"), "topics": list(d.get("topics") or []),
            "commit_sha": commit_sha,
        })


class RepositoryError(RuntimeError):
    """Something about the connected repository, phrased for a person."""


async def load_corpus(gh: GitHubClient, repo: str, branch: str) -> tuple[str, dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """→ (commit sha, manifest, chunks, document metadata from front matter + manifest)."""
    try:
        sha = await gh.head_sha(repo, branch)
    except GitHubError as e:
        raise RepositoryError(f"Could not read {repo}@{branch}: check that the repository still exists and the connected account can access it.") from e
    try:
        manifest = yaml.safe_load(await gh.file_text(repo, "aftercircular.yml", sha)) or {}
    except GitHubError as e:
        if "404" in str(e):
            raise RepositoryError(f"{repo} has no aftercircular.yml manifest. Connect a policy repository that lists its documents, or add the manifest.") from e
        raise RepositoryError(f"Could not read aftercircular.yml from {repo}.") from e
    chunks: list[dict[str, Any]] = []
    docs: list[dict[str, Any]] = []
    for d in manifest.get("documents", []):
        try:
            raw = await gh.file_text(repo, d["path"], sha)
        except GitHubError as e:
            raise RepositoryError(f"Manifest lists {d['path']} but it could not be read from {repo}.") from e
        meta, body = parse_front_matter(raw)
        doc_id, title = str(meta.get("doc_id", d["id"])), str(meta.get("title", d.get("title", d["id"])))
        version = str(meta["version"]) if meta.get("version") is not None else None
        chunks.extend(chunk_markdown(doc_id, title, d["path"], version, body))
        docs.append({"doc_id": doc_id, "title": title, "path": d["path"], "version": version, "category": d.get("category"),
                     "status": meta.get("status"), "effective_date": str(meta["effective_date"]) if meta.get("effective_date") else None,
                     "owner": meta.get("owner"), "approver": meta.get("approver"), "review_cycle": meta.get("review_cycle"),
                     "topics": d.get("topics", []), "applies_to": meta.get("applies_to", []), "regulator_references": meta.get("regulator_references", [])})
    return sha, manifest, chunks, docs


def company_profile(manifest: dict[str, Any], tenant: TenantContext) -> str:
    c = manifest.get("company", {})
    if not c:
        return f"{tenant.company_name} (profile not available — repository has no aftercircular.yml)"
    regs = ", ".join(f"{r.get('authority')} {r.get('type')}" for r in c.get("registrations", []))
    return (f"{c.get('legal_name', tenant.company_name)} — {c.get('sector', 'unknown sector')}, {c.get('city', '')} {c.get('country', '')}. "
            f"Regulator: {c.get('regulator', 'n/a')}. Registrations: {regs or 'n/a'}. Exchanges: {', '.join(c.get('exchanges', []))}. "
            f"Segments: {', '.join(c.get('segments', []))}. Review SLA: {manifest.get('compliance', {}).get('review_sla_days', 'n/a')} days.")


async def ensure_indexed(db: StateStore, gh: GitHubClient, tenant: TenantContext, retriever, embed) -> tuple[dict[str, Any], bool]:
    """Re-index only when the default branch moved (PRD §8A: latest policy = head of default branch)."""
    sha, manifest, chunks, docs = await load_corpus(gh, tenant.github_repo, tenant.default_branch)
    meta = db.policy_index_meta(tenant.tenant_id)
    if meta and meta["commit_sha"] == sha and meta["chunk_count"] == len(chunks) and meta.get("documents") and await retriever.is_ready(tenant.tenant_id):
        return manifest, False
    enrich_chunks(chunks, docs, manifest, sha)
    # embed only chunks whose text changed; unchanged chunks reuse the vector cached in policy_chunks (SQLite is the cache)
    cached = {chunk_hash(r["text"]): r.get("embedding") for r in db.policy_chunks(tenant.tenant_id)}
    todo = [c for c in chunks if not cached.get(c["chunk_hash"])]
    vectors = await embed([c["text"] for c in todo]) if todo else []
    if todo and not vectors:
        vectors = [None] * len(todo)  # provider has no embedding model → keyword-only, say nothing more
    for c, v in zip(todo, vectors or []):
        c["embedding"] = v
    for c in chunks:
        c.setdefault("embedding", cached.get(c["chunk_hash"]))
    log.info("policy index %s: %d chunks, %d embedded, %d reused", tenant.tenant_id, len(chunks), sum(1 for c in todo if c.get("embedding")), len(chunks) - len(todo))
    await retriever.index(tenant.tenant_id, chunks)
    db.replace_policy_chunks(tenant.tenant_id, tenant.github_repo, sha, chunks, docs)
    return manifest, True
