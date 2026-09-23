# Azure AI Search retrieval evaluation — 2026-09-23T03:48:55.243085+00:00

Service `https://srch-aftercircular-dev.search.windows.net` · index `policies-dev` · hybrid: BM25 + vector (HNSW cosine) fused by RRF; semantic ranker not configured · embeddings text-embedding-3-small (1536-d)

Documents in index: acme-securities-pvt-ltd=48, nimbus-asset-management=46

## Retrieval quality

| tenant | query | expected | hit | rank | top-3 |
|---|---|---|:--:|---:|---|
| acme-securities-pvt-ltd | client unpaid securities pledge payment period trading days | POL-001 | ✓ | 1 | POL-001 §5.1 Payment period (0.03333); POL-001 §6.1 Invocation (0.03279); POL-001 §3 Definitions (0.03226) |
| acme-securities-pvt-ltd | cyber incident reporting to SEBI portal within hours | POL-002 | ✓ | 1 | POL-002 §4.1 Initial report (0.03333); POL-002 §4.2 Staged reporting (0.03252); POL-002 §7 Review cadence (0.03175) |
| acme-securities-pvt-ltd | position limits exposure derivatives risk | POL-003 | ✓ | 1 | POL-003 §3 Client-level limits (0.03333); POL-003 §5 Proprietary book (0.03227); POL-003 §1 Purpose (0.03226) |
| acme-securities-pvt-ltd | standing instructions demat account depository participant | POL-005 | ✓ | 1 | POL-005 §3 Client instructions (0.03333); POL-005 §2 Scope (0.03252); POL-005 §1 Purpose (0.03227) |
| nimbus-asset-management | intraday borrowing by a scheme to meet redemptions | POL-001 | ✓ | 1 | POL-001 §4.2 Quantum (0.03333); POL-001 §4.1 Permitted purposes (0.03279); POL-001 §4.7 Cost (0.032) |
| nimbus-asset-management | distributor NISM certification specialized investment fund | POL-002 | ✓ | 1 | POL-002 §4.2 Specialized Investment Fund strategies (0.03333); POL-002 §1 Purpose (0.03252); POL-002 §4.1 Mutual fund schemes (0.03252) |
| nimbus-asset-management | cyber incident reporting | POL-003 | ✓ | 1 | POL-003 §4 Regulatory reporting (0.03333); POL-003 §1 Purpose (0.03227); POL-003 §3 Response (0.03227) |
| nimbus-asset-management | SWP STP standing instructions demat units | POL-004 | ✓ | 1 | POL-004 §3 Systematic plans for units held in statement form (0.03333); POL-004 §1 Purpose (0.03279); POL-004 §4 Units held in demat form (0.032) |

Expected policy in top-5: **8/8**

## Tenant isolation

| tenant filter | cross-tenant bait query | results | foreign rows | doc ids |
|---|---|---:|---:|---|
| acme-securities-pvt-ltd | distributor NISM certification specialized investment fund scheme | 6 | **0** | POL-001, POL-003, POL-005 |
| nimbus-asset-management | client unpaid securities pledge trading member | 2 | **0** | POL-002, POL-003 |

## Embedding / index reality

```json
{
  "id": "acme-securities-pvt-ltd-181441765_POL-001_1-8d3ef89a43",
  "doc_id": "POL-001",
  "section": "1 Purpose",
  "stored_chunk_hash": "b3799959590e26e698333a62",
  "recomputed_chunk_hash": "b3799959590e26e698333a62",
  "commit": "bbad523fbad7ca989d918f6dca8f6de3ecabfa9f",
  "query_vector_dims": 1536,
  "nearest_by_vector": [
    [
      "acme-securities-pvt-ltd-181441765_POL-001_1-8d3ef89a43",
      1.0
    ],
    [
      "acme-securities-pvt-ltd-181441765_POL-001_3-e6416d2f47",
      0.87814
    ],
    [
      "acme-securities-pvt-ltd-181441765_POL-001_4_1-f53c1e0d33",
      0.83749
    ]
  ],
  "self_is_nearest": true,
  "index_meta_commit": "bbad523fbad7ca989d918f6dca8f6de3ecabfa9f",
  "hash_matches": true,
  "commit_matches_index_meta": true
}
```
