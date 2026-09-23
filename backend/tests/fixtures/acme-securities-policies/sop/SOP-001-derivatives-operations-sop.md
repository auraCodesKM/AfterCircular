---
doc_id: SOP-001
title: Derivatives Operations SOP
version: "1.4"
status: active
effective_date: 2025-08-20
last_reviewed: 2025-08-20
review_cycle: semi-annual
owner: Head of Operations
approver: Chief Risk Officer
regulator_references:
  - Exchange operating guidelines for the equity derivatives segment (fictional)
applies_to: [derivatives-operations-desk, dealing-desk, rms]
---

# SOP-001 Derivatives Operations SOP

> Fictional document for demonstration. Not a real procedure.

## 1. Purpose

Step-by-step procedures for the Derivatives Operations Desk to monitor limits, manage margins and handle expiry.

## 2. Daily timeline (IST)

| Time | Task | Owner |
|---|---|---|
| 08:30 | Load exchange limit files and margin parameters into RMS | Ops |
| 09:00 | Confirm client-level limit tables match POL-001 §4 | Ops + Risk |
| 09:15 – 15:30 | Limit utilisation monitored every 30 minutes (POL-001 §5.1) | RMS |
| 15:45 | Margin call list generated | Ops |
| 18:30 | Daily position-limit report sent (POL-001 §5.3) | Ops |

## 3. Limit table maintenance

### 3.1 Source of truth

The RMS limit table shall be generated from POL-001 §4 on the first trading day after any approved amendment. No manual override is permitted.

### 3.2 Change control

Changes to the limit table require a ticket referencing the POL-001 version and the approver.

## 4. Margin calls

1. Identify shortfalls from the 15:45 list.
2. Notify the client via SMS and email by 16:15 with the amount and deadline (T+1, 10:00).
3. Record the notification in the margin-call log.

## 5. Expiry day

### 5.1 Physical settlement

For stock derivatives, confirm by 13:00 that clients with in-the-money positions have either the securities or funds to settle; otherwise proceed to §6.

### 5.2 Index derivatives

Cash-settled; confirm final settlement price import by 16:00.

## 6. Square-off

Positions may be squared off without further notice when: (a) utilisation reaches 100% of a limit (POL-001 §5.2), (b) margin is not received by the §4 deadline, or (c) a ledger debit exceeds T+5 (POL-002 §4.3). Every square-off shall be logged with time, reason and clause.

## 7. Exceptions

Temporary limit enhancements (POL-001 §7) shall be entered in RMS only after the CRO's written approval is attached to the ticket.

## 8. Review

Semi-annual review by the Head of Operations.
