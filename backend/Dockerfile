# AfterCircular API — FastAPI on Azure Container Apps.
# State is SQLite on a mounted Azure Files volume (DATABASE_PATH, default /data/aftercircular.db): durable across
# revisions and restarts, single writer (the API runs with one replica — see DEPLOYMENT.md).

# ---- build: resolve dependencies once, into a self-contained venv -------------------------------------------------
FROM python:3.12-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=ghcr.io/astral-sh/uv:0.9.9 /uv /usr/local/bin/uv
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ---- runtime: no uv, no build tools, non-root ----------------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH="/opt/venv/bin:$PATH" PORT=8000
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown app:app /data
WORKDIR /app
# DATABASE_PATH lives here; a named volume (local) or an Azure Files share (ACA) is mounted over it.
VOLUME ["/data"]
COPY --from=build /opt/venv /opt/venv
# application code, the real SEBI source registry, the curated snapshot (tests/demo mode only) and the operational scripts
COPY --chown=app:app app ./app
COPY --chown=app:app regulatory_sources ./regulatory_sources
COPY --chown=app:app evals ./evals
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app data/snapshot ./data/snapshot
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",8000)}/health/live',timeout=4)"
# exec form → uvicorn is PID 1 and handles SIGTERM itself (graceful drain on revision swap)
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 25 --no-access-log"]
