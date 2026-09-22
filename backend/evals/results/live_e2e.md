# Live end-to-end evaluation — acme-securities-pvt-ltd-181441765

Provider **foundry** (gpt-5-mini), retrieval **azure-ai-search**, embedding text-embedding-3-small.
Guardrails: {'max_documents_per_scan': 6, 'max_llm_calls_per_scan': 10, 'max_retries': 2, 'max_concurrent_calls': 2, 'scan_cost_limit_usd': 0.5, 'daily_cost_limit_usd': 5.0}

## Scans

| scan | status | new | skipped | LLM calls | est. cost | wall | error |
|---|---|---:|---:|---:|---:|---:|---|
| scan_6932b27011be | COMPLETED | 6 | 0 | 6 | $0.0519 | 242.9s |  |
| scan_463bc57a5143 | COMPLETED | 0 | 6 | 0 | $0.0000 | 12.8s |  |

## Cases

| case | source | expected | actual | match | Jev calls | notes |
|---|---|---|---|:--:|---:|---|
| 102584 · Addressed to all stock brokers. Acme POL-001 gives clients seven trading days (c… | live | {"applicability": "YES", "gate": "CONFLICT", "affected_policies": ["POL-001"]} | {"applicability": "YES", "alignment": "CONFLICT", "gate": "CONFLICT", "affected_policies": ["POL-001"], "confidence": 0.76, "severity": "operational"} | ✓ | 22 | triage prefilter/skipped; path typesafe:extraction_check → typesafe:applicability → typesafe:rerank → typesafe:alignment → typesafe:verification; retrieved POL-001; memo=True; review=AWAITING_REVIEW |
| 102762 · Addressed to mutual funds, AMCs, trustees and AMFI; Acme is a broker.… | live | {"applicability": "NO", "gate": "ARCHIVED", "affected_policies": []} | {"applicability": "NO", "alignment": null, "gate": "ARCHIVED", "affected_policies": [], "confidence": 1.0, "severity": null} | ✓ | 1 | triage triage/archive; path typesafe:triage; retrieved ; memo=False; review=None |
| 102914 · Addressed to depository participants (Acme is one) but the obligations fall on d… | live | {"applicability": "UNCERTAIN", "gate": "NEEDS_INVESTIGATION", "affected_policies": []} | {"applicability": "YES", "alignment": null, "gate": "NEEDS_INVESTIGATION", "affected_policies": ["POL-005"], "confidence": 0.85, "severity": "operational"} | ✓ | 17 | triage prefilter/skipped; path typesafe:extraction_check → typesafe:applicability → typesafe:rerank → typesafe:alignment → foundry:escalation → typesafe:cross_check; retrieved POL-003, POL-005, SOP-001; memo=False; review=None |
| 102986 · Addressed to MFs, AMCs, trustees, RTAs and AMFI; Acme does not distribute MF or … | live | {"applicability": "NO", "gate": "ARCHIVED", "affected_policies": []} | {"applicability": "NO", "alignment": null, "gate": "ARCHIVED", "affected_policies": [], "confidence": 1.0, "severity": null} | ✓ | 1 | triage triage/archive; path typesafe:triage; retrieved ; memo=False; review=None |
| 103915 · Addressed to all regulated entities including stock brokers. Acme POL-002 §4 alr… | live | {"applicability": "YES", "gate": "ALIGNED", "affected_policies": []} | {"applicability": "YES", "alignment": null, "gate": "NEEDS_INVESTIGATION", "affected_policies": ["POL-002"], "confidence": 0.88, "severity": "operational"} | ✗ | 19 | triage triage/proceed; path typesafe:triage → typesafe:extraction_check → typesafe:applicability → typesafe:rerank → typesafe:alignment → foundry:escalation → typesafe:cross_check; retrieved POL-002, POL-004; memo=False; review=None |
| 104387 · Addressed to stock exchanges with a commodity derivatives segment; Acme has no c… | live | {"applicability": "NO", "gate": "ARCHIVED", "affected_policies": []} | {"applicability": "NO", "alignment": null, "gate": "ARCHIVED", "affected_policies": [], "confidence": 1.0, "severity": null} | ✓ | 1 | triage triage/archive; path typesafe:triage; retrieved ; memo=False; review=None |
| 8/9. duplicate document + repeated scan (idempotency) | live | {"new": 0, "llm_calls": 0} | {"new": 0, "skipped": 6, "llm_calls": 0} | ✓ |  |  |
| 5. ambiguous applicability | offline-test | see tests | — | ✓ (pytest) | | tests/test_triage_and_cross_check.py::test_triage_proceeds_whenever_uncertain + tests/test_decisions.py::test_not_applicable_needs_high_confidence_and_low_entity_scope |
| 6. conflicting evidence (Jev vs Foundry) | offline-test | see tests | — | ✓ (pytest) | | tests/test_triage_and_cross_check.py::test_disagreement_routes_to_a_person_not_to_a_ticket |
| 7. missing policy evidence | offline-test | see tests | — | ✓ (pytest) | | tests/test_cost_guard_and_safety.py::test_gate_never_accepts_a_conflict_without_two_sided_evidence + tests/test_decisions.py::test_fabricated_evidence_never_becomes_conflict |
| 10. model/provider failure | offline-test | see tests | — | ✓ (pytest) | | tests/test_cost_guard_and_safety.py::test_foundry_unavailable_fails_the_document_not_the_truth, ::test_search_unavailable_is_a_visible_failure_not_a_guess, tests/test_decisions.py::test_judge_outage_degrades_to_human_not_to_a_guess |

## Totals

- Foundry calls: **6** (retries 0, errors 0, unknown pricing 0)
- Tokens: input 14,210 · output 24,329 · cached 1,536
- Estimated cost (list-price estimate): **$0.0519**
- Jev calls (decision records): 61
- Avg Foundry latency: 34158 ms
- Search: {'chunks_indexed': 48, 'commit': 'bbad523fbad7ca989d918f6dca8f6de3ecabfa9f', 'backend': 'azure-ai-search'}
- Live cases matched: 6/7
