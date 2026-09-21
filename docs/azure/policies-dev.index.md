# `policies-dev` — Azure AI Search index: validation report

Companion to `policies-dev.index.json` (paste into *srch-aftercircular-dev → Indexes → Add index → Add index (JSON)*).
Generated from the repository at commit `37cb1aa` by serializing the index with the installed SDK
(`azure-search-documents` **12.0.0**, REST API **2026-04-01**), so the JSON is exactly what the code's `SearchIndexClient`
would send. No application code was changed.

## What the code expects today (`backend/app/retrieval/azure_search.py`, `services/policies.py`)

| Item | Current code | This index |
|---|---|---|
| Index name | `policies-<tenant_id>` (one per tenant, `index_name()`) | **`policies-dev`** (one per environment) — **mismatch, intended** |
| Tenant isolation | by index | by `tenant_id` filter — **code must add the field on upload and `filter=` on query** |
| Key | `id` (chunk_id sanitized `[^A-Za-z0-9_\-=]→_`) | `id` |
| Fields written on upload | `id, doc_id, title, path, version, section, text, vector` | same names + `tenant_id, category, effective_date, status, regulator, jurisdiction, topics, commit_sha, chunk_hash` |
| Fields selected on query | `id, doc_id, title, path, version, section, text` | all present, same types |
| `doc_id` | filterable | filterable + facetable (superset) |
| `text` | searchable, analyzer `en.microsoft` | same |
| `title` | plain `SimpleField` | **searchable** (`en.microsoft`) — superset; hybrid BM25 also matches titles |
| `vector` | `Collection(Edm.Single)`, dims **1536** (`AzureSearchRetriever(dims=1536)`), profile **`hnsw`**, algorithm **`hnsw-algo`** | identical names, dims and profile; HNSW parameters made explicit (m=4, efConstruction=400, efSearch=500, cosine — the service defaults) |
| Semantic ranker | opt-in via `AZURE_SEARCH_SEMANTIC_CONFIG` (empty by default; `semantic_search=None`) | **not configured** — Free tier has no semantic ranker and the code does not use it by default |
| Vectorizers, indexers, data sources, skillsets | none | none — the application populates the index |

Metadata available in the code to fill the new fields (from `load_corpus`): `category` (manifest), `version`, `status`,
`effective_date` (front matter, currently a `YYYY-MM-DD` string → must be sent as `YYYY-MM-DDT00:00:00Z` for `Edm.DateTimeOffset`),
`topics` (manifest list), `commit_sha` (`head_sha`); `regulator`/`jurisdiction` come from the manifest `company` block;
`chunk_hash` = sha256 of chunk text (to be added). None of these are written by the current `index()` yet.

## Field-by-field

| Field | Type | Key | Searchable | Filterable | Sortable | Facetable | Why it exists |
|---|---|---|---|---|---|---|---|
| `id` | Edm.String | ✔ | | ✔ | | | unique chunk key; filterable so a single chunk can be re-fetched/deleted by id |
| `tenant_id` | Edm.String | | | ✔ | | ✔ | **tenant isolation** — every query carries `tenant_id eq '<id>'` |
| `doc_id` | Edm.String | | | ✔ | | ✔ | policy identity (POL-001…); evidence cites it; facet for "which policies matched" |
| `title` | Edm.String | | ✔ | | | | BM25 signal; shown in evidence |
| `category` | Edm.String | | | ✔ | | ✔ | policy / sop / legal — filter or facet |
| `path` | Edm.String | | | | | | repository path for the memo/ticket link |
| `version` | Edm.String | | | ✔ | | | policy version as declared in front matter (`"2.3"`) — string, not number |
| `effective_date` | Edm.DateTimeOffset | | | ✔ | ✔ | | date filters ("policies effective before the circular's date"); sortable for newest-first |
| `status` | Edm.String | | | ✔ | | ✔ | `active` / `retired` — retired chunks stay for audit, excluded from retrieval by filter |
| `section` | Edm.String | | | | | | clause label (`4.1 Client-level limits …`) — cited as `§` in evidence |
| `regulator` | Edm.String | | | ✔ | | ✔ | SEBI / RBI — lets a circular's regulator narrow the corpus later |
| `jurisdiction` | Edm.String | | | ✔ | | ✔ | IN … |
| `topics` | Collection(Edm.String) | | | ✔ | | ✔ | manifest `topics` — boost/filter hint (`topics/any(t: t eq 'position-limits')`) |
| `commit_sha` | Edm.String | | | ✔ | | | which repository commit produced the chunk — provenance, re-index diffing |
| `chunk_hash` | Edm.String | | | ✔ | | | incremental re-indexing: unchanged chunks are not re-embedded |
| `text` | Edm.String | | ✔ | | | | the clause text — BM25 field; returned as evidence |
| `vector` | Collection(Edm.Single) 1536 | | ✔ (vector) | | | | HNSW vector for semantic similarity; `stored: true` so the value can be inspected in the portal |

## Answers

1. **Searchable:** `title`, `text` (BM25, `en.microsoft` analyzer); `vector` (vector search).
2. **Filterable:** `id`, `tenant_id`, `doc_id`, `category`, `version`, `effective_date`, `status`, `regulator`, `jurisdiction`,
   `topics`, `commit_sha`, `chunk_hash`. Facetable: `tenant_id`, `doc_id`, `category`, `status`, `regulator`, `jurisdiction`, `topics`.
   Sortable: `effective_date`.
3. **Key:** `id`.
4. **Vector field:** `vector`, profile `hnsw` → algorithm `hnsw-algo`.
5. **1536 dimensions** because the deployed embedding model is `text-embedding-3-small` (native 1536) and the code constructs
   `AzureSearchRetriever(dims=1536)`; a different model (3-large = 3072) would need a new index.
6. **Metric: cosine.** `text-embedding-3-*` vectors are unit-normalised, cosine is the documented choice for them and the
   service default for HNSW; the code passed no metric, so it already gets cosine — now it is explicit.
7. **HNSW:** `m=4, efConstruction=400, efSearch=500` — the service defaults, adequate for a corpus of tens to thousands of chunks.
8. **Tenant isolation:** one index; the backend adds `tenant_id` to every uploaded document and `filter="tenant_id eq '<tenant>'
   and status eq 'active'"` to every query; the browser never talks to Search. Facet on `tenant_id` gives per-company counts
   without extra indexes.
9. **Hybrid + RRF:** a query with both `search_text` (BM25 over `title`,`text`) and `vector_queries` (k-NN over `vector`)
   is fused server-side with Reciprocal Rank Fusion; nothing extra to configure in the index. The code already sends both
   (`search(search_text=query, vector_queries=[VectorizedQuery(...)])`).
10. **Semantic ranking:** not configured. Not used by default in the code (`AZURE_SEARCH_SEMANTIC_CONFIG` empty), not available
    on the Free tier, and Jev reranking fills the role. If ever enabled (Basic+), the code adds a `SemanticConfiguration` on
    `title`/`text` itself; the JSON does not need it now.
11. **Free tier:** compatible — one index (limit 3), vector fields allowed, ~40 chunks × 1536 floats ≈ 0.25 MB (limit 50 MB),
    no indexer/skillset/vectorizer, no semantic configuration.
12. **Mismatches to resolve in code before the first Search-backed scan** (no code changed here):
    - `index_name(tenant_id)` → constant `policies-dev` from a new `AZURE_SEARCH_INDEX` setting.
    - upload: add `tenant_id`, `category`, `effective_date` (ISO 8601 with `Z`), `status`, `regulator`, `jurisdiction`,
      `topics`, `commit_sha`, `chunk_hash`.
    - query: add `filter="tenant_id eq '…' and status eq 'active'"`; `is_ready()` must count with the same filter (today it uses
      `get_document_count()` on the whole index).
    - `_ensure_index()` must **not** call `create_or_update_index` with today's shorter field list against this index — Azure
      rejects field removal; it should either send this full definition or skip creation when the index exists.
    - `dims` should come from a new `EMBEDDING_DIMENSIONS` setting (default 1536) instead of the constructor default.
    - `scripts/live_check.py search` currently indexes into a tenant named `live-check` → with the single-index change it becomes a
      `tenant_id` value, not a second index.
