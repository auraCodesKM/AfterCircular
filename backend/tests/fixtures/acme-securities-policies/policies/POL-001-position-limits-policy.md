---
doc_id: POL-001
title: Position Limits Policy
version: "2.3"
status: active
effective_date: 2025-04-01
last_reviewed: 2025-04-01
review_cycle: annual
owner: Head of Risk — Derivatives
approver: Board Risk Committee
regulator_references:
  - SEBI (Stock Brokers) Regulations (fictional edition)
  - Exchange circulars on position limits in the equity derivatives segment (fictional)
applies_to: [index-derivatives, stock-derivatives, currency-derivatives, proprietary-book, client-accounts]
---

# POL-001 Position Limits Policy

> Fictional document for demonstration. Not a real policy.

## 1. Purpose

This policy sets the maximum open positions that Acme Securities Private Limited ("Acme") and its clients may hold in exchange-traded derivatives, so that Acme never breaches exchange-prescribed limits and never exposes itself to concentration risk beyond the appetite approved by the Board Risk Committee.

## 2. Definitions

- **Open Interest (OI)**: total outstanding contracts in a derivative series.
- **Client-Level Limit**: the maximum gross open position a single client may hold across all series of an underlying.
- **Member-Level Limit**: the maximum gross open position Acme may hold across all clients and its proprietary book.
- **Index Derivatives**: futures and options on a broad-market index (e.g. the fictional "ACME 50").
- **Prior Framework**: the limit schedule adopted by the Board Risk Committee on 2025-04-01 and reproduced in §4.
- **Near-Month Contract**: the contract expiring in the current calendar month.

## 3. Scope

Applies to all client accounts, proprietary trading, and any account for which Acme acts as clearing member. Currency derivatives are covered by §6.

## 4. Limits

### 4.1 Client-level limits — index derivatives

Client-level position limits for index derivatives are set per the Prior Framework and reviewed annually. The limits are fixed caps and do not vary with the client's margin or net worth:

| Product | Gross limit per client | Basis |
|---|---|---|
| Index futures | 500 crore notional or 15% of total OI, whichever is higher | Prior Framework |
| Index options | 500 crore notional or 15% of total OI, whichever is higher | Prior Framework |
| Near-Month index options (net) | 250 crore notional | Prior Framework |

Any revision to this table requires Board Risk Committee approval at the annual review.

### 4.2 Client-level limits — stock derivatives

For single-stock futures and options, the client-level limit is 1% of the free-float market capitalisation of the underlying or 5% of open interest, whichever is lower.

### 4.3 Member-level limits

Acme's member-level gross open position in index derivatives shall not exceed 15% of total market open interest in that underlying, or the exchange-prescribed member limit, whichever is lower.

### 4.4 Proprietary book

The proprietary desk shall not exceed 40% of the member-level limit in any underlying. Intraday breaches above 35% trigger an alert to the Head of Risk under POL-005 severity S3.

## 5. Monitoring

### 5.1 Frequency

Position utilisation shall be computed at end of day and at least once every 30 minutes during market hours by the Risk Management System (RMS).

### 5.2 Thresholds

| Utilisation of limit | Action |
|---|---|
| ≥ 80% | Warning to client and dealer |
| ≥ 90% | New position-increasing orders blocked |
| ≥ 100% | Square-off notice under SOP-001 §6 |

### 5.3 Reporting

A daily position-limit report shall be sent to the Head of Risk and the CCO by 18:30 IST.

## 6. Currency derivatives

Client-level limits in currency derivatives follow the exchange-prescribed limits without internal reduction. Acme shall not apply a lower internal cap unless directed by the CRO.

## 7. Exceptions

Temporary limit enhancements of up to 20% for a named client may be approved by the CRO for a period not exceeding 5 trading days, and must be reported to the Board Risk Committee at its next meeting.

## 8. Review

This policy shall be reviewed annually by the Board Risk Committee. Interim changes to §4.1 are not permitted outside the annual review except where an exchange or SEBI direction makes the current limits unlawful, in which case POL-004 §7 applies.
