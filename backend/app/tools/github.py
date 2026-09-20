"""GitHub REST tool: read the policy repository, create the compliance issue. Deterministic code, no LLM."""

import base64
import logging

import httpx

from app.config import settings
from app.schemas.actions import TicketPayload

log = logging.getLogger(__name__)
API = "https://api.github.com"


class GitHubError(RuntimeError):
    pass


class GitHubClient:
    def __init__(self, token: str | None):
        tok = token or settings().github_token
        if not tok:
            raise GitHubError("No GitHub token: sign in again or set GITHUB_TOKEN on the backend")
        self.h = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    async def _req(self, method: str, path: str, **kw) -> httpx.Response:
        async with httpx.AsyncClient(base_url=API, headers=self.h, timeout=30) as c:
            r = await c.request(method, path, **kw)
        if r.status_code >= 400:
            msg = r.json().get("message", r.text[:120]) if r.headers.get("content-type", "").startswith("application/json") else r.text[:120]
            raise GitHubError(f"GitHub {r.status_code} on {method} {path}: {msg}")
        return r

    async def head_sha(self, repo: str, branch: str) -> str:
        r = await self._req("GET", f"/repos/{repo}/commits/{branch}")
        return r.json()["sha"]

    async def file_text(self, repo: str, path: str, ref: str) -> str:
        r = await self._req("GET", f"/repos/{repo}/contents/{path}", params={"ref": ref})
        j = r.json()
        if j.get("encoding") == "base64":
            return base64.b64decode(j["content"]).decode("utf-8", errors="replace")
        raise GitHubError(f"unexpected content encoding for {path}")

    async def find_issue(self, repo: str, marker: str) -> dict | None:
        """Idempotency: an open or closed issue whose body carries our analysis marker."""
        r = await self._req("GET", "/search/issues", params={"q": f'repo:{repo} in:body "{marker}"', "per_page": 5})
        items = r.json().get("items", [])
        return items[0] if items else None

    async def create_issue(self, repo: str, payload: TicketPayload) -> dict:
        r = await self._req("POST", f"/repos/{repo}/issues", json=payload.model_dump())
        return r.json()
