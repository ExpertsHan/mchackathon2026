---
document_name: AI Subsidy Program 2026
version: 2026.1-demo
effective_from: 2026-01-01
effective_to: 2026-12-31
topic: program_policy
fictional: true
---

# AI Subsidy Program 2026

> Demo policy only. This document is fictional and is not Taiwanese law, regulation, or official government guidance.

## Article 1 — Purpose

The demo program assists eligible citizens with the cost of approved AI productivity subscriptions while promoting safe and responsible AI use. The program demonstrates a digital-service workflow; it does not create a legal entitlement or promise a real payment.

## Article 2 — Applicant Requirement

An applicant must have a verified demo government identity and must be at least 18 years old on the date the application is submitted. Only predefined fictional profiles are used in this demonstration.

## Article 3 — Program Period

The active demo subsidy period is 2026-01-01 through 2026-12-31, inclusive. The subscription purchase date shown by the receipt must fall inside this period.

## Article 4 — Subscription Evidence

The applicant must provide a supported receipt containing enough information to establish the provider, product, purchase date, and amount. A receipt may also contain a reference number and account email. Missing or ambiguous required fields require human review; imperfect extraction alone is not an automatic rejection.

## Article 5 — Eligible Products

The eligible subscriptions are ChatGPT Plus, Claude Pro, and Notion AI. Other products, free plans, usage credits, hardware, and unrelated subscriptions are not automatically eligible. An unknown or ambiguous product must be referred for manual review rather than treated as eligible.

## Article 6 — Reimbursement

The maximum reimbursement is NT$600 per eligible subscription per calendar month. The reimbursement is the lower of the eligible receipt cost in New Taiwan dollars and NT$600:

`approved_amount_twd = min(eligible_cost_twd, 600)`

For this demo only, static conversion rates are TWD 1, USD 30, and EUR 32. These are mock exchange rates and are not live financial data.

## Article 7 — Duplicate Claims

The same receipt may not be reimbursed more than once. The system compares the SHA-256 fingerprint of uploaded bytes against receipts associated with submitted, approved, scheduled, or paid claims. A match is a high-risk duplicate-receipt flag and requires human review.

## Article 8 — Monthly Limit

A citizen may receive at most one reimbursement for each calendar month. A prior application in APPROVED, PAYMENT_SCHEDULED, or PAID status for the same purchase month consumes the monthly allowance. A possible duplicate monthly claim requires human review.

## Article 9 — AI Safety Training

All four required AI safety modules must be completed before an application can be submitted. The required topics are privacy, hallucinations, prompt injection and suspicious content, and human responsibility. Wrong quiz answers may be retried.

## Article 10 — Manual Review

Ambiguous, inconsistent, suspicious, or unverifiable claims may be sent to a government reviewer. Examples include a duplicate receipt, unknown product, low extraction confidence, conflicting provider and product, implausible values, or an undetermined date. A reviewer must record a reason for approval, rejection, or a request for more information.

## Article 11 — Payment

Payment occurs only after the application is in APPROVED state. The mock treasury must read the approved amount from the persisted application, never from a browser request. Payment moves through PAYMENT_SCHEDULED to PAID and creates an auditable fictional transaction identifier. An AI model has no authority to approve an application or authorize payment.

## Authority and accountability

The AI assistant may retrieve and explain this policy, extract receipt data, and invoke narrow application tools. Deterministic rules evaluate eligibility. The government workflow owns application status. The mock treasury owns payment state. Human reviewers remain accountable for exceptional cases.
