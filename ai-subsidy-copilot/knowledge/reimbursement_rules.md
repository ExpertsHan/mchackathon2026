---
document_name: Reimbursement Rules Guide
version: 2026.1-demo
effective_from: 2026-01-01
effective_to: 2026-12-31
topic: reimbursement
fictional: true
---

# Reimbursement Rules Guide

> Demo guidance only. No real funds are transferred.

## Monthly cap

The eligible reimbursement is capped at NT$600. If a receipt converts to NT$420, the estimated subsidy is NT$420. If it converts to NT$750, the estimated subsidy is NT$600.

## Mock currency conversion

The demonstration uses static rates:

| Currency | Mock TWD rate |
| --- | ---: |
| TWD | 1 |
| USD | 30 |
| EUR | 32 |

The converted amount is rounded to the nearest whole New Taiwan dollar using normal financial rounding. The UI must label the result “Mock exchange rate used for demonstration.” Unsupported currencies require manual review.

## One successful claim per month

The purchase date determines the calendar month. An APPROVED, PAYMENT_SCHEDULED, or PAID application consumes that user’s allowance for the month. Draft, submitted, verifying, rejected, or information-requested cases do not by themselves represent a paid subsidy, although possible overlap can be surfaced to reviewers.

## Duplicate evidence

The exact same receipt bytes produce the same SHA-256 fingerprint. A fingerprint already used by a submitted or later-stage application is a high-risk flag. The rule engine does not silently approve it and the AI assistant cannot clear the flag.
