# AI Subsidy Copilot — judge Q&A

## Why use AI here?

Citizens need policy language translated into practical next steps, and receipt fields need to be extracted from messy documents. AI helps with those language and evidence tasks. It does not decide eligibility, approve a claim, override a rule, delete an audit record, or move money.

## Is this an autonomous agent?

No, intentionally. It is a controlled copilot with narrow server-owned operations. The model can generate a grounded explanation when configured, while the application state, checks, review actions, and payment flow stay in deterministic services.

## How do you prevent hallucinated policy?

The knowledge corpus is ingested into chunks with citation metadata. Retrieval uses a hybrid lexical/vector path and effective-date filters. Unknown products return “cannot establish” rather than an affirmative policy answer. The UI shows citations next to the answer.

## What stops prompt injection in a receipt?

The receipt parser accepts a narrow set of known fields. Other document text is untrusted data. Suspicious content raises risk and routes to manual review. It never becomes an instruction source for the assistant and never reaches payment authority.

## Why make safety training part of the application?

Because the behavior matters at the moment of use. Four short modules cover privacy, hallucinations, prompt injection, and human responsibility. Answers are graded server-side, attempts are persisted, and all four modules gate submission.

## Can a reviewer override the system?

Only through an explicit reviewer action that requires a reason, and not when a mandatory policy rule has failed. The action is recorded in the audit trail with an actor label.

## Can a double click pay twice?

The mock payment is idempotent. The service requires `APPROVED`, reads the approved amount from the database, enforces a unique application payment record, and transitions through `PAYMENT_SCHEDULED` to `PAID`.

## Is this production-ready?

No. It is an MVP and says so clearly. Production work would add reviewer IAM and role enforcement, OCR for scanned documents, malware scanning, encrypted storage and key lifecycle, retention and backup policies, real payment integration, reconciliation, and formal accessibility/security review.

## What is real and what is fictional?

The identities, policy, receipts, rates, reviewers, and payments are fictional. The workflow and its controls are real code that runs locally. No bank, identity provider, tax system, vendor billing account, or government database is connected.

## What did you test?

The repository has targeted backend tests for RAG, eligibility, receipts, privacy, state transitions, concurrency, payment, and API flows. A fresh smoke run passed the happy path, payment idempotency, duplicate receipt, under-age applicant, and prompt-injection scenarios. Asset verification passed for the nine knowledge files and six receipt PDFs.

## What would you measure in a pilot?

Citizen completion rate, time to submit, request-for-information rate, reviewer time per claim, exception precision, duplicate catch rate, payment reconciliation errors, and safety-module comprehension. We would measure whether the workflow reduces confusion without reducing review quality.

