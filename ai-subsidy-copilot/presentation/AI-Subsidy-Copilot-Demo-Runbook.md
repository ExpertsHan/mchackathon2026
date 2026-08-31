# AI Subsidy Copilot — live demo runbook

## Preflight

```bash
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:8000/health
python3 scripts/verify_demo_assets.py
make smoke
make reset
```

Expected health: `status: ok`, `database: connected`, `demo_mode: true`. Run `make reset` after `make smoke`, because smoke intentionally mutates the database.

## URLs

- Citizen portal: `http://localhost:3000`
- Reviewer console: `http://localhost:3000/admin`
- API docs fallback: `http://localhost:8000/docs`
- Backend health: `http://localhost:8000/health`

## Demo identities

| Applicant | Demo ID | Age | Best use |
|---|---|---:|---|
| Alex Chen | `A12****789` | 21 | Happy path, ChatGPT Plus, NT$600 |
| Jamie Lin | `B23****456` | 25 | Prompt injection / manual review |
| Taylor Wang | `C34****123` | 17 | Age-rule failure backup |

There are no passwords. These are fictional identities. Reviewer APIs are intentionally demo-only and have no production IAM.

## Happy path, Alex

1. Open the citizen portal and choose **Start demo application**.
2. Choose **Alex Chen**.
3. Choose **ChatGPT Plus**. The product selection triggers a policy eligibility question and a citation.
4. Upload `demo/receipts/chatgpt_plus_valid.pdf`.
5. Confirm the extracted values: OpenAI, ChatGPT Plus, USD 20.00, 2026-08-18, `DEMO-OPENAI-001`, 100% confidence.
6. Run the eligibility check. Expect six passing checks and safety pending, with a provisional NT$600 outcome.
7. Open **AI safety**. Complete the four modules with the correct choices:
   - Privacy: A public article you want summarized.
   - Hallucinations: Verify the official demo policy source.
   - Prompt Injection: No.
   - Human Responsibility: No.
8. Return to the application, review, and submit.
9. After reset, Jamie's seeded historical claim is `AI-2026-000001`; Alex's new claim is normally `AI-2026-000002`.
10. Open `/admin`, find Alex, open the record, and show the evidence, seven checks, citations, LOW risk, and audit timeline.
11. Click **Process payment** once. Expect `GOVPAY-DEMO-…` and `PAID`.
12. Refresh the citizen tracking view. Show the same transaction ID and persisted timeline.

## Adversarial encore, Jamie

1. Switch applicant to Jamie.
2. Choose ChatGPT Plus.
3. Upload `demo/receipts/malicious_prompt_injection_receipt.pdf`.
4. Point out the valid receipt fields plus the embedded requests to reveal records and pay TWD 100000.
5. Confirm the evidence. Expect HIGH risk and `MANUAL_REVIEW`.
6. Open the reviewer detail. Show **Suspicious document text detected**.
7. Leave it in manual review. Say: “This is where accountable human review belongs.”

Use Jamie for this case. A second Alex application in the same month can add a monthly-limit flag and muddy the story.

## Fallback ladder

1. Seeded paid record: `AI-2026-000001`, Jamie, NT$480, `GOVPAY-DEMO-SEED0001`.
2. If the UI fails, show `/docs` or the successful smoke output.
3. If OpenAI is slow, use the structured steps. The demo can run with deterministic offline answers.
4. If the browser state is confusing, run `make reset`, reload, and use **Switch applicant**.

