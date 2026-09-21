# Live end-to-end evaluation — acme-securities-pvt-ltd-181441765

Provider **foundry** (gpt-5-mini), retrieval **azure-ai-search**, embedding text-embedding-3-small.
Guardrails: {'max_documents_per_scan': 3, 'max_llm_calls_per_scan': 10, 'max_retries': 2, 'max_concurrent_calls': 2, 'scan_cost_limit_usd': 0.5, 'daily_cost_limit_usd': 5.0}

## Scans

| scan | status | new | skipped | LLM calls | est. cost | wall | error |
|---|---|---:|---:|---:|---:|---:|---|
| scan_802484b91f26 | COMPLETED | 3 | 0 | 4 | $0.0243 | 120.3s |  |
| scan_14b92da74952 | COMPLETED | 0 | 3 | 0 | $0.0000 | 6.7s |  |

## Cases

| case | source | expected | actual | match | Jev calls | notes |
|---|---|---|---|:--:|---:|---|
| 4. applicable + conflict | live | {"applicability": "YES", "gate": "CONFLICT", "affected_policies": ["POL-001"]} | {"applicability": "YES", "alignment": "CONFLICT", "gate": "CONFLICT", "affected_policies": ["POL-001"], "confidence": 0.91, "severity": "operational"} | ✓ | 23 | triage prefilter/skipped; path typesafe:extraction_check → typesafe:applicability → typesafe:rerank → typesafe:alignment → typesafe:verification; retrieved POL-001; memo=True; review=APPROVED |
| 3. applicable + aligned | live | {"applicability": "YES", "gate": "ALIGNED", "affected_policies": []} | {"applicability": "YES", "alignment": "CONFLICT", "gate": "CONFLICT", "affected_policies": ["POL-001"], "confidence": 0.79, "severity": null} | ✗ | 18 | triage prefilter/skipped; path typesafe:extraction_check → typesafe:applicability → typesafe:rerank → typesafe:alignment → typesafe:verification; retrieved POL-001, POL-002, POL-004, POL-005; memo=True; review=AWAITING_REVIEW |
| 2. clearly irrelevant (mutual funds / AMCs) | live | {"applicability": "NO", "gate": "ARCHIVED", "affected_policies": []} | {"applicability": "NO", "alignment": null, "gate": "ARCHIVED", "affected_policies": [], "confidence": 1.0, "severity": null} | ✓ | 1 | triage triage/archive; path typesafe:triage; retrieved ; memo=False; review=None |
| 8/9. duplicate document + repeated scan (idempotency) | live | {"new": 0, "llm_calls": 0} | {"new": 0, "skipped": 3, "llm_calls": 0} | ✓ |  |  |
| 5. ambiguous applicability | offline-test | see tests | — | ✓ (pytest) | | tests/test_triage_and_cross_check.py::test_triage_proceeds_whenever_uncertain + tests/test_decisions.py::test_not_applicable_needs_high_confidence_and_low_entity_scope |
| 6. conflicting evidence (Jev vs Foundry) | offline-test | see tests | — | ✓ (pytest) | | tests/test_triage_and_cross_check.py::test_disagreement_routes_to_a_person_not_to_a_ticket |
| 7. missing policy evidence | offline-test | see tests | — | ✓ (pytest) | | tests/test_cost_guard_and_safety.py::test_gate_never_accepts_a_conflict_without_two_sided_evidence + tests/test_decisions.py::test_fabricated_evidence_never_becomes_conflict |
| 10. model/provider failure | offline-test | see tests | — | ✓ (pytest) | | tests/test_cost_guard_and_safety.py::test_foundry_unavailable_fails_the_document_not_the_truth, ::test_search_unavailable_is_a_visible_failure_not_a_guess, tests/test_decisions.py::test_judge_outage_degrades_to_human_not_to_a_guess |

## Totals

- Foundry calls: **4** (retries 0, errors 0, unknown pricing 0)
- Tokens: input 4,432 · output 11,571 · cached 0
- Estimated cost (list-price estimate): **$0.0243**
- Jev calls (decision records): 42
- Avg Foundry latency: 22845 ms
- Search: {'chunks_indexed': 82, 'commit': '1e886eb2828a20f0c3f50f6ad262c307b30dd84d', 'backend': 'azure-ai-search'}
- Live cases matched: 3/4

## Reading the one mismatch (DEMO-2026-015)

The golden label says ALIGNED (POL-004 §7.3 sets a 30-day review SLA). The live run found a **two-sided, verified conflict in a
different policy**: circular §2.2 requires affected policies to be amended within 30 calendar days, while POL-001 §8 says the
policy is reviewed annually and "interim changes to §4.1 are not permitted outside" that review (P(conflicts)=0.86, citation
verified). That is a defensible finding the label did not anticipate, not a pipeline fault; it is now AWAITING_REVIEW for a
person to decide. The label is left unchanged and the case is reported as a mismatch.
