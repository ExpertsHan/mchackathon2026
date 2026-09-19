---
document_name: AI Subsidy Program 2026
version: 2026.2
effective_from: 2026-04-02
effective_to: 2026-10-31
topic: program_policy
fictional: false
---

# AI Subsidy Program 2026

> Hsinchu City "AI領航青年數位工具補助計畫". These rules are enforced by the RULE-001~020 engine; the assistant only explains them. Anything not stated here must be confirmed with the Youth Development Center rather than guessed.

## Article 1 — Purpose

The program helps young Hsinchu City residents pay for AI productivity subscriptions while promoting safe and responsible AI use. Funds are limited; the program stops accepting applications when the budget is used up.

## Article 2 — Applicant Requirement

An applicant must be 16 to 40 years old, meaning born between 1985-04-03 and 2010-04-02 (ROC 74/4/3 to 99/4/2), and must have a household registration address in Hsinchu City (新竹市) as shown on the ID card. Three applicant categories exist: normal youth (一般青年), special groups (特定對象), and cultural and language preservers (文化語言保存者).

## Article 3 — Program Period

The subscription purchase date must fall between 2026-04-02 and 2026-10-31, inclusive.

## Article 4 — Application Deadline

A monthly plan must be applied for within 1 month of purchase. An annual plan must be applied for within 2 months of purchase. Late applications are not accepted.

## Article 5 — Eligible Products

Only tools on the Eligible AI Services Register qualify: general, image, office, learning and other AI tools bought as subscriptions directly from the official site. Not eligible: tools developed or operated in Mainland China, Hong Kong or Macau; purchases through aggregator or reseller platforms; and API quota, credit, token, points or prepaid top-up items. A tool that is not on the register is referred to a human reviewer, never treated as eligible.

## Article 6 — Subsidy Amount

The subsidy is a percentage of the eligible purchase amount in New Taiwan dollars, capped per person:

| Category | Rate | Cap |
| --- | ---: | ---: |
| Normal youth | 50% | NT$3,000 |
| Special group or cultural/language preserver | 90% | NT$6,000 |

`subsidy = min(round(eligible_amount_twd * rate), cap)`. For monthly plans the amounts of all covered months are added. The amount shown before approval is a trial estimate; only a reviewer's approval fixes the payable amount. If the purchase amount cannot be established the estimate is "unknown", never zero.

## Article 7 — Duplicate Claims

The same receipt may not be used twice. The system compares receipt file fingerprints and the receipt reference, company, amount and date of applications that are submitted, approved, scheduled or paid. A match is a high-risk FRAUD_RISK flag that a human must review.

## Article 8 — One Application at a Time

One person may have only one application in progress at a time. A finished application (approved, paid, rejected or cancelled) does not block a new one.

## Article 9 — Optional AI Safety Learning

AI safety learning must not become a barrier to applying for the subsidy. Applicants may review four optional topics: privacy, hallucinations, prompt injection and suspicious content, and human responsibility. An optional, skippable scenario exercise may be offered after submission with an immediate explanation and no required retake. Participation and answers never affect eligibility, submission, review, approval, or payment.

## Article 10 — Rule Results and Manual Review

The rule engine returns one of five results: PASS, REVIEW, NEED_SUPPLEMENT, REJECT or FRAUD_RISK. The AI never approves or rejects an application. Every submitted application goes to a human reviewer: PASS means no issue was found, REJECT is a recommendation to decline, FRAUD_RISK is the highest-priority review. NEED_SUPPLEMENT reopens the application so the applicant can upload the missing documents and resubmit. A reviewer must record their name and a reason for approval, rejection, or a request for more information, and must explicitly confirm an override when a rule flagged the case.

## Article 11 — Payment

Payment occurs only after a reviewer has approved the application. The mock treasury reads the approved amount from the persisted application, never from a browser request. Payment moves through PAYMENT_SCHEDULED to PAID and creates an auditable fictional transaction identifier. An AI model has no authority to approve an application or authorize payment.

## Authority and accountability

The AI assistant may retrieve and explain this policy, read documents with OCR, and invoke narrow read-only tools. The RULE-001~020 engine evaluates eligibility and the trial amount. The government workflow owns application status. The mock treasury owns payment state. Human reviewers remain accountable for every decision.
