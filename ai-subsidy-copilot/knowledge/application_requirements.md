---
document_name: Application Requirements Guide
version: 2026.1-demo
effective_from: 2026-01-01
effective_to: 2026-12-31
topic: application_process
fictional: true
---

# Application Requirements Guide

## What an applicant needs

1. A predefined demo profile with verified identity status and an age of at least 18.
2. An eligible AI product selection.
3. A PDF, PNG, JPG, or JPEG receipt no larger than the service upload limit.
4. Evidence of provider, product, purchase date, and amount.
5. Completion of all four required AI safety modules.

## Application stages

Applications begin in DRAFT. Submission moves the record to SUBMITTED and deterministic verification moves it to VERIFYING. A complete low-risk claim may then be automatically approved by the policy rule engine. Ambiguous or suspicious claims move to MANUAL_REVIEW. A reviewer may approve, reject, or request more information with a recorded reason.

## What AI does and does not do

The AI assistant helps explain policy, identifies missing information, extracts receipt fields, and presents the deterministic checks. It cannot change program rules, approve or reject a claim, alter the subsidy amount, bypass safety training, or authorize a payment.

## Privacy

Only fake, masked identifiers belong in this demo. Raw identity numbers, bank data, private receipt contents, and application histories must never be added to the policy vector store. The assistant receives the minimum application context needed for the current action.
