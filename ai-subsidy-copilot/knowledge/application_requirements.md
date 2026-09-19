---
document_name: Application Requirements Guide
version: 2026.2
effective_from: 2026-04-02
effective_to: 2026-10-31
topic: application_process
fictional: false
---

# Application Requirements Guide

## What an applicant needs

1. To be 16 to 40 years old with a Hsinchu City household registration.
2. The applicant details: contact information, birth date, addresses, billing plan (monthly or annual), tool name and company, purchase date, original amount and currency, the NT$ amount, and whether the applicant's own credit card paid.
3. Photos or scans (PDF, PNG, JPG or WEBP) of the required documents.

## Required documents

- ID card, both sides (the address must be readable).
- Purchase receipt: the official receipt (subscriber name and email, full tool name, company, date, period, original amount, payment method), the NT$ conversion and the payment proof (billing statement), plus the last four card digits when paid by card.
- Bank passbook cover in the applicant's own name; the subsidy is paid to this account.
- Signed declaration (切結書).
- Proof document for special groups or cultural/language preservers (only for those categories).
- Payer declaration signed by the parent, spouse or legal guardian (only when someone else paid).

Optional AI safety learning is available, but it is not an application requirement and never affects an application decision.

## Application stages

Applications begin in DRAFT. When the details are saved and each document is uploaded, OCR reads the documents and the RULE-001~020 engine checks them. Submission moves the record through SUBMITTED and VERIFYING into MANUAL_REVIEW, where a human reviewer decides. If documents are missing the application is returned as REQUESTED_INFORMATION so the applicant can supplement it and submit again. A reviewer may approve, reject, or request more information with their name and a recorded reason. An applicant may cancel until approval.

## What AI does and does not do

The AI reads documents, compares them with the applicant's declarations, flags issues, and explains policy. It cannot change program rules, approve or reject a claim, alter the subsidy amount, or authorize a payment.

## Privacy

The national ID number is read for matching only and is not stored in full; the system keeps a masked form and a keyed hash. Raw identity numbers, bank data, private receipt contents, and application histories must never be added to the policy vector store.
