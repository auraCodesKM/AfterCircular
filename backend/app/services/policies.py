"""Policy corpus: GitHub repo (aftercircular.yml manifest + markdown docs) → front-matter metadata → section chunks."""

import re
from typing import Any

import yaml

from app.schemas.actions import TenantContext
from app.services.state import StateStore
from app.tools.github import GitHubClient, GitHubError

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
        chunks.append({
            "chunk_id": f"{doc_id}#{section}", "doc_id": doc_id, "title": title, "path": path, "version": version,
            "section": label, "text": f"{doc_id} — {title} §{label}\n{text}",
        })
    return chunks


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
    vectors = await embed([c["text"] for c in chunks]) if chunks else None
    for i, c in enumerate(chunks):
        c["embedding"] = vectors[i] if vectors else None
    await retriever.index(tenant.tenant_id, chunks)
    db.replace_policy_chunks(tenant.tenant_id, tenant.github_repo, sha, chunks, docs)
    return manifest, True
