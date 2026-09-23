---
doc_id: POL-002
title: Trading Risk Management Policy
version: "2.1"
status: active
effective_date: 2025-04-01
last_reviewed: 2025-04-01
review_cycle: annual
owner: Chief Risk Officer
approver: Board Risk Committee
regulator_references:
  - Exchange risk management framework for the equity derivatives segment (fictional)
  - SEBI circular on upfront margin collection (fictional)
applies_to: [cash-equity, equity-derivatives, currency-derivatives, margin-trading]
---

# POL-002 Trading Risk Management Policy

> Fictional document for demonstration. Not a real policy.

## 1. Purpose

Defines how Acme measures, limits and monitors trading risk arising from client and proprietary activity.

## 2. Definitions

- **Upfront Margin**: margin collected from a client before an order is accepted.
- **Peak Margin**: the highest margin obligation observed for a client during a trading day.
- **Exposure Multiplier**: the ratio of permitted intraday exposure to available margin.
- **Ledger Debit**: a negative client ledger balance after settlement.

## 3. Margin collection

### 3.1 Upfront margin

Acme shall collect the full applicable Upfront Margin (SPAN + exposure for derivatives; VaR + ELM for cash) before accepting any order that increases exposure.

### 3.2 Peak margin

Peak Margin shall be computed from exchange snapshot files and any shortfall shall be reported and penalised per POL-003 §4.

### 3.3 Acceptable collateral

| Collateral | Haircut | Cap |
|---|---|---|
| Cash and cash equivalents | 0% | none |
| Approved liquid securities | as per exchange VaR, minimum 10% | 50% of total collateral |
| Non-approved securities | not accepted | — |

## 4. Exposure limits

### 4.1 Intraday exposure multiplier

The Exposure Multiplier for intraday cash equity positions shall not exceed 4x of available margin. (Reduced from 5x on 2025-04-01.)

### 4.2 Carry-forward

Carry-forward positions require 100% of applicable margin by end of day; positions without adequate margin are squared off under SOP-001 §6.

### 4.3 Ledger debit

A Ledger Debit older than T+5 trading days shall result in a freeze on new positions and liquidation of holdings to the extent of the debit.

## 5. Concentration and stress

### 5.1 Single-client concentration

No single client shall account for more than 12% of Acme's total margin obligation to the clearing corporation.

### 5.2 Stress testing

The RMS shall run a daily stress test using a ±7% index move and a ±15% single-stock move; results shall be reviewed by the CRO weekly.

## 6. Surveillance

Orders shall be screened pre-trade for price band, quantity freeze, and self-trade prevention. Alerts route via POL-005.

## 7. Review

Annual review by the Board Risk Committee. Any exchange circular changing margin methodology triggers an interim review under POL-004 §7.
