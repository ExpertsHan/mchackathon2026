# AI Subsidy Copilot

> Apply smarter. Learn safer. Track every dollar.

**Demo system — not an official government service.** Every person, identity, policy, receipt, review, and payment in this repository is fictional. The application does not connect to banks, national identity systems, tax services, vendor billing accounts, or government databases.

## 1. Overview

AI Subsidy Copilot is a locally runnable government-service MVP that guides a citizen from a policy question to an auditable mock subsidy payment. It combines a conversational assistant and Retrieval-Augmented Generation (RAG) with structured forms, deterministic eligibility rules, integrated AI-safety learning, human review, and a state-checked mock treasury.

The core trust boundary is visible throughout the product:

> AI assists the process. Rules determine eligibility. Government systems authorize payment. Humans remain responsible for exceptional cases.

## 2. Problem

Citizens often need to interpret policy, identify evidence, fill repetitive forms, and wait without understanding status. Governments also need consistent decisions, fraud controls, traceable evidence, and responsible-use education. A chatbot alone cannot safely provide those guarantees.

## 3. Solution

The citizen portal combines policy chat with reliable application controls. The assistant retrieves only relevant policy chunks and returns citations. Receipt text is parsed as untrusted data. A pure rule engine evaluates each policy rule. Low-risk complete claims may be approved by a deterministic policy workflow, while ambiguous or suspicious claims enter manual review. A separate mock payment service refuses any state other than `APPROVED`.

## 4. Features

- Demo login with Alex Chen, Jamie Lin, and Taylor Wang
- Chat-centered application flow with structured quick actions
- Citation-bearing policy answers with an offline fallback
- PDF, PNG, JPG, and JPEG receipt validation and safe local storage
- Deterministic parsing for the included text PDFs and optional OpenAI vision for images
- SHA-256 duplicate detection and deterministic LOW/MEDIUM/HIGH risk scoring
- Seven individually explained eligibility checks and a static mock currency conversion
- Four short safety modules with server-checked quizzes, retry, scores, and progress
- Submission gating, friendly `AI-2026-000001` IDs, and enforced state transitions
- Citizen status tracking derived from stored state and audit events
- Reviewer metrics, filters, search, evidence, citations, risk, and audit history
- Reason-required approve, reject, and request-information actions
- Idempotent mock payment scheduling/completion with `GOVPAY-DEMO-…` IDs
- Demo reset and seeded happy-path, duplicate, under-age, ambiguous, and injection cases
- FastAPI OpenAPI documentation, Docker Compose, and automated tests

## 5. Architecture

```text
                         CITIZEN
                            │
                            ▼
                 ┌────────────────────┐
                 │   Next.js Portal   │
                 └─────────┬──────────┘
                           │ REST/JSON
                           ▼
                ┌──────────────────────┐
                │ FastAPI Application  │
                └──────────┬───────────┘
                           │
          ┌────────────────┼──────────────────┐
          │                │                  │
          ▼                ▼                  ▼
 ┌────────────────┐ ┌──────────────┐ ┌────────────────┐
 │ Controlled AI  │ │ Eligibility  │ │ Receipt        │
 │ Assistant      │ │ Rule Engine  │ │ Analyzer       │
 └───────┬────────┘ └───────┬──────┘ └────────────────┘
         │                  │
         ▼                  ▼
 ┌────────────────┐ ┌──────────────────┐
 │ RAG Retriever  │ │ Application DB   │
 └───────┬────────┘ └────────┬─────────┘
         │                   │
         ▼                   ▼
 ┌────────────────┐ ┌──────────────────┐
 │ pgvector       │ │ Mock Payment     │
 │ Policy Corpus  │ │ Service          │
 └────────────────┘ └────────┬─────────┘
                             │
                             ▼
                     ┌──────────────┐
                     │ Audit Ledger │
                     └──────────────┘
```

The backend is a modular monolith. Route handlers validate transport data; services own domain rules and transactions; SQLAlchemy owns persistence. SQLite is a convenient no-container development fallback, while the Docker path uses PostgreSQL with the `vector` extension.

## 6. AI and RAG design

Knowledge lives in `knowledge/`, never in the system prompt. Ingestion parses Markdown into article/section chunks, creates embeddings, and stores chunk text, dates, version, topic, and citation metadata. With `OPENAI_API_KEY` and `OPENAI_EMBEDDING_MODEL`, it uses the official OpenAI embeddings API. Otherwise it creates deterministic feature-hashed vectors so retrieval and tests continue offline. PostgreSQL ranks with pgvector cosine distance and adds a transparent lexical signal.

The policy answer path is:

```text
Markdown policy → chunks → embeddings → pgvector
                                      ↑
citizen question → query embedding → hybrid top-k → answer + structured citations
```

Chat generation supports Google AI Studio and OpenAI. In `AI_PROVIDER=auto` mode, a configured `GEMINI_API_KEY` is preferred; otherwise a configured OpenAI key uses the Responses API. Gemini uses Google's OpenAI-compatible Chat Completions endpoint so the existing SDK, server-sent event streaming, sanitized conversation window, and server-executed read-only tools remain shared. Retrieved content is explicitly marked as untrusted evidence. Without a working provider, deterministic grounded answers cover the demo policy. Unknown questions return “cannot establish” rather than a fabricated policy section.

The model can call only two strict, read-only tools: current-policy search and an owner-scoped application-progress lookup. Eligibility checks, evidence changes, submission, approval, review overrides, and payment remain explicit website/backend actions and are never model tools.

References: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [OpenAI Responses API migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses), [OpenAI embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).

## 7. Safety design

Safety is both product content and an engineering boundary:

- Privacy, hallucinations, prompt injection, and human responsibility are mandatory modules.
- Correct answers stay server-side until a response is graded.
- Every attempt and completion is persisted; all four required modules gate submission.
- Uploaded and retrieved text is data, never an instruction source.
- The malicious demo receipt is parsed for valid receipt fields but cannot trigger actions.
- The assistant receives masked identity data and only the minimum context required.
- No private receipt or citizen record is placed in the vector knowledge base.
- The UI shows concise rule explanations and citations, never hidden model reasoning.

## 8. Eligibility, approval, and payment separation

| Concern | Authority | May use AI? |
| --- | --- | --- |
| Explain policy | RAG assistant | Yes, grounded and cited |
| Extract receipt fields | Receipt service | Optional vision enhancement |
| Evaluate seven rules | Deterministic eligibility service | No decision authority delegated |
| Approve low-risk complete claim | Policy workflow / rule engine | No |
| Resolve exceptional claim | Human reviewer action | AI explanation only |
| Calculate subsidy | Deterministic currency/cap code | No |
| Schedule and complete payment | Mock treasury service | No |

`Process Payment` performs a server-side `status == APPROVED` check, reads `approved_amount_twd` from the database, creates at most one payment, transitions through `PAYMENT_SCHEDULED`, and records the completion. The browser cannot supply or change the paid amount.

## 9. Tech stack

- Next.js, React, TypeScript, Tailwind CSS, and accessible composable UI components
- Python 3.11+, FastAPI, Pydantic Settings, SQLAlchemy 2, psycopg 3
- PostgreSQL and pgvector, with SQLite for lightweight offline development/tests
- Gemini via Google's OpenAI-compatible endpoint, plus native OpenAI Responses/embeddings support
- pypdf for text PDF extraction, local non-public receipt storage
- pytest and Ruff; ESLint, TypeScript, and Next production build checks
- Docker Compose for the full three-service environment

## 10. Project structure

```text
ai-subsidy-copilot/
├── backend/                  FastAPI app, domain services, RAG, scripts, tests
├── frontend/                 Next.js citizen portal and reviewer console
├── knowledge/                fictional policy and safety corpus
├── demo/
│   ├── receipts/             six deterministic sample PDFs
│   └── DEMO_SCRIPT.md        five-minute presentation flow
├── scripts/                  receipt generator and Postgres initialization
├── docker-compose.yml
├── .env.example
├── Makefile
└── README.md
```

## 11. Quick start

The fastest complete setup uses Docker:

```bash
cd ai-subsidy-copilot
cp .env.example .env
docker compose up --build
```

Then open:

- Citizen portal: <http://localhost:3000>
- Reviewer console: <http://localhost:3000/admin>
- Backend health: <http://localhost:8000/health>
- Interactive API docs: <http://localhost:8000/docs>

In demo mode, backend startup creates the schema, installs the vector extension in PostgreSQL, seeds demo records, and ingests the knowledge corpus idempotently. An external AI key is not required.

## 12. Environment variables

Copy `.env.example` to `.env`. Do not commit the result.

| Variable | Purpose | Demo behavior when blank |
| --- | --- | --- |
| `AI_PROVIDER` | `auto`, `gemini`, or `openai` | `auto` prefers Gemini, then OpenAI |
| `GEMINI_API_KEY` | Server-side Google AI Studio credential | Gemini chat disabled |
| `GEMINI_MODEL` | Gemini chat model ID | Defaults to `gemini-3.7-flash` |
| `GEMINI_REASONING_EFFORT` | Gemini reasoning level | `low` for the latency-sensitive demo chat |
| `OPENAI_API_KEY` | Server-side OpenAI credential | OpenAI chat/optional enhancements disabled |
| `OPENAI_MODEL` | Responses model ID | Defaults to `gpt-5.6-luna` unless explicitly blank |
| `OPENAI_EMBEDDING_MODEL` | Embedding model ID | Deterministic vectors if key/model unavailable |
| `OPENAI_REASONING_EFFORT` | Responses reasoning effort | `none` for the latency-sensitive demo chat |
| `OPENAI_TIMEOUT_SECONDS` | OpenAI request timeout | 20 seconds |
| `AGENT_MAX_OUTPUT_TOKENS` | Per-turn output cap | 600 tokens |
| `AGENT_MAX_TOOL_ROUNDS` | Maximum read-only tool rounds | 2 rounds |
| `DATABASE_URL` | SQLAlchemy URL | Backend defaults to a local SQLite file |
| `DEMO_MODE` | Enables seed/reset/mock treasury | Should be `true` for this MVP |
| `DEMO_AUTH_SECRET` | Signs local demo bearer tokens | Local demo-only value; replace outside this MVP |
| `CORS_ORIGINS` | Comma-separated browser origins | Local ports only |
| `RECEIPT_STORAGE_DIR` | Private local upload directory | `backend/storage/receipts` locally |
| `MAX_RECEIPT_BYTES` | Upload limit | 5 MiB in Compose |
| `MAX_PDF_PAGES` | PDF resource-abuse limit | 10 pages |
| `MAX_EXTRACTED_CHARS` | Maximum extracted receipt text | 50,000 characters |
| `KNOWLEDGE_DIR` | Corpus directory | Repository `knowledge/` |
| `NEXT_PUBLIC_API_URL` | Browser-visible API origin | `http://localhost:8000` |

API keys are read only by the backend. `/health` reports a boolean configuration flag and never returns credential values.

## 13. Running with Docker

```bash
# foreground
make dev

# background
docker compose up --build -d

# status and logs
docker compose ps
docker compose logs -f backend frontend

# stop without deleting data
docker compose down
```

PostgreSQL data and uploaded receipts use named volumes. `make reset` resets demo rows through the protected demo-only endpoint; `make clean-docker` removes this project’s containers and volumes and is intentionally separate.

## 14. Running locally

PostgreSQL is recommended for demonstrating pgvector, but the backend’s default SQLite URL runs all non-Postgres workflows.

### Backend

If you copied the root `.env.example`, its sample URL expects PostgreSQL. Start only
the database with `docker compose up -d postgres`, or select the zero-service SQLite
fallback for this terminal:

```bash
export DATABASE_URL=sqlite:///./ai_subsidy_demo.db
```

Then start the backend:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m app.scripts.init_db
.venv/bin/python -m app.scripts.seed
.venv/bin/python -m app.scripts.ingest_knowledge
.venv/bin/uvicorn app.main:app --reload --port 8000
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Open <http://localhost:3000>. If model configuration fails or an AI call is unavailable, use the same structured application controls; the service does not crash or block non-AI work.

## 15. Knowledge ingestion

From `backend/` with dependencies installed:

```bash
.venv/bin/python -m app.scripts.ingest_knowledge
```

The command is idempotent and reports how many chunks were stored. In Docker:

```bash
docker compose exec backend python -m app.scripts.ingest_knowledge
```

Do not add citizen records, raw IDs, receipts, or application history to `knowledge/`. To regenerate the sample PDFs:

```bash
python3 scripts/generate_demo_receipts.py
```

## 16. Demo accounts

| Applicant | Demo identity | Age | Intended scenario |
| --- | --- | ---: | --- |
| Alex Chen | `A12****789` | 21 | ChatGPT Plus happy path, NT$600 |
| Jamie Lin | `B23****456` | 25 | Notion AI duplicate, HIGH risk/manual review |
| Taylor Wang | `C34****123` | 17 | Claude Pro age rule failure |

All emails use the reserved `.test` domain. Login is a profile selector that issues a signed, local demo bearer token. That token enforces profile ownership inside the demo, but it is not proof of a real government identity.

## 17. Demo scenarios

The complete five-minute script is [demo/DEMO_SCRIPT.md](demo/DEMO_SCRIPT.md).

- **Happy path:** Alex → ChatGPT Plus → `chatgpt_plus_valid.pdf` → complete four safety modules → submit → automatic rule-engine approval → process payment → citizen sees PAID.
- **Duplicate:** Jamie → Notion AI → `duplicate_receipt.pdf`, byte-identical to the seeded Notion evidence → HIGH risk → MANUAL_REVIEW.
- **Under age:** Taylor → Claude Pro → `claude_pro_valid.pdf` → `AGE_REQUIREMENT` fails.
- **Ambiguous:** upload `ambiguous_receipt.pdf` → missing required evidence and low confidence → manual review.
- **Prompt injection:** upload `malicious_prompt_injection_receipt.pdf` → valid fields are extracted; embedded commands are ignored and cannot approve, reveal, or pay.

Reset before a presentation:

```bash
make reset
```

## 18. Testing

```bash
# everything
make test

# with a backend already running on port 8000
make smoke

# backend unit/API suite and lint
cd backend
.venv/bin/pytest
.venv/bin/ruff check app tests

# frontend static checks and production compilation
cd frontend
npm run lint
npm run typecheck
npm run build
```

The 61-test backend suite covers adult/under-age/product/duplicate/monthly/safety/cap calculations; invalid state transitions; payment state, amount authority, and idempotency; demo-token ownership and citizen-data redaction; requested-information resubmission; immutable receipt evidence; concurrent claim reservations; file limits and malicious/vision receipt isolation; persisted decision snapshots and citations; sanitized agent-session persistence; repeatable resets; grounded RAG retrieval; Gemini/OpenAI agent orchestration; and unknown-product phrasing. Tests never require a live external AI request.

## 19. API documentation

FastAPI publishes the live OpenAPI schema at <http://localhost:8000/openapi.json> and Swagger UI at <http://localhost:8000/docs>. Major groups are:

- `/health`
- `/api/demo/*`
- `/api/applications/*` and `/api/users/*/applications`
- `/api/agent/chat`, `/api/agent/chat/stream`, `/api/agent/history`, and `/api/policy/search`
- `/api/safety/*`
- `/api/admin/*`

Errors use a stable envelope:

```json
{
  "error": {
    "code": "SAFETY_TRAINING_INCOMPLETE",
    "message": "Complete all required AI safety modules before submission."
  }
}
```

## 20. Security considerations

- Fake masked identities only; no real government authentication or financial integration
- Signed local demo bearer tokens, citizen-route ownership checks, and redacted citizen responses
- Pydantic request validation and parameterized ORM queries
- Strict extension, MIME signature, byte/page/text limits, basename, UUID storage-name, and containment checks
- Receipt files stored outside frontend/public paths; internal storage paths are not returned
- SHA-256 evidence fingerprints, immutable server-authoritative extraction data, and database-backed claim reservations for duplicate/monthly controls
- Retrieved/uploaded text treated as untrusted; no document instruction can invoke actions
- Vision-only model extraction cannot auto-approve a claim; it requires human review unless deterministic evidence corroborates it
- Agent-session history is bounded, length-capped, secret/PII-redacted, and reduced to the typed workflow fields needed for continuity
- Narrow model context and no unnecessary PII in prompts or vector storage
- State-machine validation and service-side reviewer/payment authorization
- Reason-required manual actions and append-only behavior through normal application APIs
- Idempotent payment record protected by a unique application constraint
- Narrow local CORS origins and no secret values in health responses or logs

This is still a demo security baseline, not a production authorization boundary.

## 21. Known MVP limitations

- Signed demo tokens prevent cross-profile citizen access, but they are not real identity verification; the demo reviewer console intentionally has no production authentication or role enforcement.
- SQLite fallback does not use pgvector; Docker/PostgreSQL does.
- Image OCR requires configured OpenAI vision; image-only/vision-derived evidence enters manual review rather than becoming an automatic approval authority.
- PDF parsing targets text PDFs and does not perform local OCR on scans.
- Static USD/TWD/EUR rates are deliberately fictional and do not account for taxes or historical settlement dates.
- Receipt hashes detect identical bytes, not visually altered or semantically duplicated invoices.
- The controlled assistant persists workflow state but is intentionally smaller than a production case-management agent.
- Local filesystem receipt storage, no Alembic migration history, and in-process startup initialization are MVP choices.
- Reviewer authentication, CSRF controls, malware scanning, retention policy, key management, backups, high availability, and formal accessibility certification are out of scope.

## 22. Future production architecture

A production service would add government identity federation and role-based reviewer IAM; managed PostgreSQL/pgvector with migrations, backup, encryption, and row-level protections; object storage with malware scanning and retention controls; queued OCR/embedding jobs; signed evidence access; a policy publishing workflow with legal approval and version pinning; model and retrieval evals; fraud case management; observability and security monitoring; separation-of-duties payment authorization; reconciliation; accessibility/user research; disaster recovery; and an independent privacy/security assessment.

It would still retain the same essential boundary: language models assist, deterministic policy services decide what can proceed, authorized government actors resolve exceptions, and treasury systems alone move funds.
