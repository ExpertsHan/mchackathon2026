# AI Subsidy Copilot — 5-minute demo

This walkthrough uses fictional people, receipts, policy, and payments. Keep the “Demo system — not an official government service” banner visible when presenting.

## 0:00–0:35 — The problem

Government subsidy applications make citizens interpret eligibility rules, discover document requirements, enter the same information repeatedly, and wait without knowing what happens next. A new AI user also needs practical safety education, but a separate course creates another drop-off point.

AI Subsidy Copilot turns that into one guided, verifiable workflow. AI helps with language and evidence; code enforces policy; reviewers handle exceptions; a separate mock treasury controls payment.

## 0:35–1:10 — Start as Alex

1. Open `http://localhost:3000`.
2. Select **Start Demo Application**.
3. Choose **Alex Chen**, age 21, masked demo ID `A12****789`.
4. Point out that no real identity provider is connected.
5. In the application assistant, choose **ChatGPT Plus**.
6. Ask: **Is ChatGPT Plus eligible?**
7. Show the answer and its source card: **AI Subsidy Program 2026 — Article 5 — Eligible Products**.

Say: “The answer is grounded in retrieved policy. If the corpus does not establish an answer, the assistant says so instead of inventing a rule.”

## 1:10–1:55 — Upload evidence

1. Upload `demo/receipts/chatgpt_plus_valid.pdf`.
2. Show the extracted provider, product, amount, currency, date, account, and receipt reference.
3. Confirm the extraction.
4. Run the eligibility check.
5. Show each deterministic result and the eligible outcome:
   - identity verified
   - age requirement met
   - eligible service
   - receipt date valid
   - no duplicate receipt
   - monthly limit available
   - optional AI safety learning is non-blocking
6. Show USD 20 × mock rate 30 = NT$600 and the estimated subsidy of NT$600.

Say: “Receipt text is data only. It cannot approve a claim or trigger a payment.”

## 1:55–2:45 — Submit, then learn safely in context

1. Submit the eligible application without opening the optional lessons.
2. Point out the clear **Application submitted** result.
3. Show the optional, skippable privacy practice.
4. Compare fictional option A, which includes an unnecessary name and full account number, with option B, which includes only the tools and amounts.
5. Choose **B** and show the immediate explanation; no retake is required.
6. Select **What about company meeting notes?** and show the RAG answer with its policy citation.

Say: “Responsible-use education appears in context, but it never becomes a condition for public service. We measure whether people saw it, joined it, and understood it as separate outcomes.”

## 2:45–3:20 — Track the submitted application

1. Point out the applicant, receipt evidence, mock conversion, subsidy, optional-learning status, and deterministic eligibility.
2. Show the generated public ID, such as `AI-2026-000001`.
3. Show the persisted timeline.

Say: “A low-risk, seven-of-seven result may be automatically approved by the policy workflow. The audit actor is RULE_ENGINE, never AI_AGENT.”

## 3:20–4:10 — Government reviewer and payment

1. Open `http://localhost:3000/admin`.
2. Point out database-calculated totals and filters.
3. Open Alex’s application.
4. Show:
   - masked applicant evidence
   - receipt hash and extracted fields
   - seven individual rule checks
   - retrieved policy citations
   - LOW risk
   - chronological audit trail
5. If it is already approved, select **Process Payment**. Otherwise run verification and use the valid approval action.
6. Show the `GOVPAY-DEMO-…` transaction and PAID state.
7. Return to citizen tracking and refresh to show **PAID**, NT$600, and the same transaction ID.

Say: “The payment service reads the approved amount from the database and refuses any application not in APPROVED state. Repeat clicks cannot create a second payment.”

## 4:10–5:00 — Human review and prompt-injection defense

### Duplicate receipt

1. Start as **Jamie Lin**.
2. Choose **Notion AI**.
3. Upload `demo/receipts/duplicate_receipt.pdf`.
4. Show the identical SHA-256 fingerprint, HIGH risk, and MANUAL_REVIEW path.

### Malicious document

1. Upload `demo/receipts/malicious_prompt_injection_receipt.pdf` in a fresh demo draft.
2. Show that the valid OpenAI, ChatGPT Plus, date, and USD 20 fields are extracted.
3. Point out the embedded instructions asking the system to reveal records and pay NT$100,000.
4. Show that no records are revealed, no payment is created, and the application still follows deterministic rules.

### Age check

1. Start as **Taylor Wang**, age 17.
2. Choose **Claude Pro** and upload `claude_pro_valid.pdf`.
3. Show **AGE_REQUIREMENT: FAIL** and that the claim cannot be automatically approved.

Close with:

> AI assists the process. Rules determine eligibility. Government systems authorize payment. Humans remain responsible for exceptional cases.

## Reset before another presentation

From the project root run:

```bash
make reset
```

The reset endpoint and command work only while `DEMO_MODE=true`.
