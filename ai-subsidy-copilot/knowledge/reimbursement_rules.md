---
document_name: Reimbursement Rules Guide
version: 2026.2
effective_from: 2026-04-02
effective_to: 2026-10-31
topic: reimbursement
fictional: false
---

# Reimbursement Rules Guide

> Payments in this system are mock treasury transactions; no real funds are transferred.

## Rates and caps

Normal youth receive 50% of the eligible purchase amount, up to NT$3,000. Special groups and cultural/language preservers receive 90%, up to NT$6,000.

Examples: a NT$630 purchase gives NT$315 for a normal applicant (50%) or NT$567 for a special applicant (90%). A NT$9,000 purchase is capped at NT$3,000 for a normal applicant.

## Which amount counts

The NT$ amount read from the receipt by OCR is used first. If the receipt amount cannot be read, the applicant's declared NT$ amount is used only as a reference and the reviewer is asked to check it. If neither is available the estimate is unknown, not zero, and the application asks for supplementary documents.

## Monthly plans

A monthly plan covers consecutive months. Every month needs its own receipt, NT$ conversion and payment proof, and the same receipt cannot be reused for different months. The eligible amount is the sum of all months.

## Duplicate evidence

The same receipt cannot be reimbursed twice. The rule engine compares file fingerprints and receipt details against other active applications. A match is a FRAUD_RISK flag; it is never silently approved and the AI assistant cannot clear it.

## Estimate versus approved amount

The amount shown while the application is being processed is a trial estimate. When a reviewer approves the application, the estimate becomes the persisted approved amount, which is the only amount the mock treasury will pay.
