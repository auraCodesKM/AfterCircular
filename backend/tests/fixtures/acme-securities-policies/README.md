# Acme Securities Pvt. Ltd. — Policy Repository

> **Fictional company. Fictional documents.** This repository exists to demonstrate AfterCircular, a regulatory-change-to-compliance-action system. Nothing here is legal advice, and no figure below should be read as a real regulatory requirement.

## Company profile

| | |
|---|---|
| Legal name | Acme Securities Private Limited |
| Registered office | 14th Floor, Marine Drive Tower, Nariman Point, Mumbai 400021, India |
| Incorporated | 2009 |
| Regulator | Securities and Exchange Board of India (SEBI) |
| Registration | SEBI Stock Broker Registration No. INZ000998877 (fictional) |
| Exchange memberships | NSE (Cash, F&O, CDS), BSE (Cash, F&O) |
| Depository participation | CDSL DP ID 12099887 (fictional) |
| Headcount | 320 |
| Clients | ~48,000 active retail and 210 institutional / proprietary accounts |
| Business segments | Cash equity broking · Equity derivatives · Currency derivatives · Margin trading facility · Research |

## Organisation

```
Board of Directors
├── Board Risk Committee
├── Audit Committee
└── Managing Director
    ├── Chief Compliance Officer (CCO)        — owns this repository
    │   ├── Compliance Manager, Trading Surveillance
    │   └── Compliance Manager, Client Onboarding
    ├── Chief Risk Officer (CRO)
    │   └── Head of Risk — Derivatives
    ├── Head of Operations
    │   └── Derivatives Operations Desk
    ├── Head of Dealing
    └── Chief Technology Officer
```

## What this repository contains

All official internal policies, standard operating procedures and legal documents of Acme Securities. **The default branch (`main`) is the single source of truth.** A policy is in force only if it is on `main` with `status: active` in its front matter.

| ID | Document | Owner | Review cycle |
|---|---|---|---|
| POL-001 | [Position Limits Policy](policies/POL-001-position-limits-policy.md) | Head of Risk — Derivatives | Annual |
| POL-002 | [Trading Risk Management Policy](policies/POL-002-trading-risk-management-policy.md) | Chief Risk Officer | Annual |
| POL-003 | [Penalty and Disciplinary Policy](policies/POL-003-penalty-and-disciplinary-policy.md) | Chief Compliance Officer | Annual |
| POL-004 | [Compliance Manual](policies/POL-004-compliance-manual.md) | Chief Compliance Officer | Annual |
| POL-005 | [Escalation Matrix](policies/POL-005-escalation-matrix.md) | Chief Compliance Officer | Semi-annual |
| POL-006 | [KYC and Client Onboarding Policy](policies/POL-006-kyc-and-client-onboarding-policy.md) | Compliance Manager, Client Onboarding | Annual |
| SOP-001 | [Derivatives Operations SOP](sop/SOP-001-derivatives-operations-sop.md) | Head of Operations | Semi-annual |
| PRIV-001 | [Client Data Privacy Policy](legal/PRIV-001-client-data-privacy-policy.md) | Chief Compliance Officer | Annual |

Machine-readable index: [`aftercircular.yml`](aftercircular.yml). Revision history: [`CHANGELOG.md`](CHANGELOG.md).

## Document conventions

Every document follows the same structure so that it can be read by people and parsed by tools:

1. **YAML front matter** with `doc_id`, `title`, `version`, `status`, `effective_date`, `last_reviewed`, `review_cycle`, `owner`, `approver`, `regulator_references`, `applies_to`.
2. **Numbered sections** (`## 4. Limits`) and **numbered clauses** (`### 4.1 Client-level limits`). Cite clauses as `POL-001 §4.1`.
3. **Normative language**: *shall* = mandatory, *should* = recommended, *may* = permitted.
4. **Defined terms** are capitalised and listed in section 2 of each document.
5. Any numeric threshold appears in a table or a single sentence, never spread across paragraphs.

## How changes are made

1. Regulatory change is detected (manually, or by AfterCircular).
2. A compliance review issue is opened using the [compliance review template](.github/ISSUE_TEMPLATE/compliance-review.md), citing the regulatory clause and the affected policy clause.
3. The CCO approves the proposed amendment.
4. A pull request updates the document, bumps `version`, updates `effective_date` and adds a `CHANGELOG.md` entry.
5. A human reviewer from `.github/CODEOWNERS` merges. **Automated systems never merge.**

## Regulatory context (fictional summary)

Acme is a SEBI-registered stock broker and clearing member. The documents here are written against the fictional versions of: SEBI (Stock Brokers) Regulations, exchange circulars on position limits and margins in the equity derivatives segment, the SEBI code of conduct for intermediaries, and the SEBI master circular on KYC. When SEBI or an exchange issues a new circular that touches any clause in this repository, the affected document must be reviewed within the period stated in POL-004 §7.
