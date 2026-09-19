"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, Info } from "lucide-react";
import { OCR_LABELS } from "@/components/document-uploader";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import type { CrossValidationRow, SourceDocumentType, SourceReview, SourceRule } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

export const DOCUMENT_LABELS: Record<SourceDocumentType, string> = {
  receipt: "購買憑證／繳款證明", id_card: "身分證正反面", passbook: "存摺封面",
  declaration: "切結書", cultural_proof: "特定對象／語言認證證明", payer_declaration: "代付關係與共同切結書",
};

/** Reviewer-facing wording for the rule engine's five verdicts. */
export const RESULT_LABELS: Record<string, string> = {
  PASS: "PASS 檢查通過", REVIEW: "REVIEW 需人工確認", NEED_SUPPLEMENT: "需補件",
  REJECT: "REJECT 建議退件", FRAUD_RISK: "FRAUD_RISK 疑似異常",
};
const RESULT_STYLE: Record<string, string> = {
  PASS: "bg-emerald-50 text-emerald-800 border-emerald-200", REVIEW: "bg-amber-50 text-amber-900 border-amber-200",
  NEED_SUPPLEMENT: "bg-orange-50 text-orange-900 border-orange-200", REJECT: "bg-red-50 text-red-800 border-red-200",
  FRAUD_RISK: "bg-red-100 text-red-900 border-red-300",
};
const MATCH_STYLE: Record<string, string> = {
  MATCH: "bg-emerald-50 text-emerald-800", PARTIAL_MATCH: "bg-amber-50 text-amber-900",
  MISMATCH: "bg-red-50 text-red-800", UNKNOWN: "bg-slate-100 text-slate-600",
};

export function ResultBadge({ result, className }: { result?: string | null; className?: string }) {
  if (!result) return null;
  return <span className={cn("inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-extrabold", RESULT_STYLE[result] ?? "bg-slate-100 text-slate-700", className)}>{RESULT_LABELS[result] ?? result}</span>;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "UNKNOWN / 無法確認";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
const percentage = (value: number | null | undefined) => (value === null || value === undefined ? "無法確認" : `${Math.round(value * 100)}%`);
const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `NT$${value.toLocaleString()}`);

/** What the applicant sees while filling in the application: progress, trial subsidy, what is missing. */
export function CitizenReviewSummary({ review }: { review?: SourceReview | null }) {
  if (!review) return null;
  const { evaluation: result, missing_documents: missing } = review;
  const subsidy = result.subsidy;
  const evaluated = Boolean(result.result) && result.documents_required;
  const items = result.supplement_center?.items ?? [];
  return (
    <div className="space-y-4" data-testid="citizen-review">
      {result.error ? <Alert tone="warning">{result.error}</Alert> : null}
      {!evaluated ? <p className="text-sm text-slate-600">儲存申請資料並上傳文件後，系統會自動辨識並以 RULE-001~020 檢查。</p> : (
        <>
          <div className={cn("rounded-xl border p-4", result.result === "PASS" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <div className="flex items-start gap-3">
              {result.result === "PASS" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />}
              <div>
                <p className="text-sm font-bold text-navy-900">{result.result === "PASS" ? "初步檢查未發現問題" : result.result === "NEED_SUPPLEMENT" ? "尚有項目需要補件" : "部分項目需要承辦人員確認"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-700">{result.policy_notice}</p>
              </div>
            </div>
          </div>
          {subsidy ? (
            <div className="rounded-xl border border-line bg-white p-4" data-testid="subsidy-estimate">
              <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-slate-500">補助金額試算（非核定金額）</p>
              {subsidy.unknown ? <p className="mt-1 text-sm font-bold text-amber-800">目前無法確認可採信的購買金額，請補件或由承辦人確認。</p> : (
                <>
                  <p className="mt-1 text-2xl font-extrabold text-navy-900">{money(subsidy.subsidy_amount)}</p>
                  <p className="mt-1 text-xs text-slate-600">可採信金額 {money(subsidy.eligible_amount)} × 費率 {percentage(subsidy.subsidy_rate)}，上限 {money(subsidy.subsidy_cap)}</p>
                </>
              )}
            </div>
          ) : null}
        </>
      )}
      {missing.length ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-bold text-orange-900">尚未上傳的文件 · {missing.length}</p>
          <ul className="mt-2 list-inside list-disc text-xs leading-6 text-orange-950">{missing.map((doc) => <li key={doc.document_type}>{doc.label}</li>)}</ul>
        </div>
      ) : null}
      {items.length ? (
        <div className="rounded-xl border border-orange-200 p-4" data-testid="supplement-items">
          <p className="flex items-center gap-2 text-sm font-bold text-orange-900"><ClipboardList className="size-4" /> 補件項目 · {items.length}</p>
          {result.supplement_center?.deadline ? <p className="mt-1 text-xs text-slate-600">建議補件期限：{result.supplement_center.deadline}</p> : null}
          <ul className="mt-2 space-y-1.5">{items.map((item) => <li key={item.rule_id} className="text-xs leading-5 text-slate-700"><strong>{item.missing_item}</strong> — {item.reason}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

const COMPARE_ROWS: Array<{ label: string; applicant: string; source: string; ocr: string }> = [
  { label: "姓名（身分證）", applicant: "name", source: "id_card", ocr: "name" },
  { label: "姓名（收據訂閱人）", applicant: "name", source: "receipt", ocr: "buyer_name" },
  { label: "姓名（存摺戶名）", applicant: "name", source: "passbook", ocr: "account_holder_name" },
  { label: "出生日期", applicant: "birth_date", source: "id_card", ocr: "birth_date" },
  { label: "戶籍地址", applicant: "household_address", source: "id_card", ocr: "address" },
  { label: "Email", applicant: "email", source: "receipt", ocr: "buyer_email" },
  { label: "軟體名稱", applicant: "applied_tool_name", source: "receipt", ocr: "product_name" },
  { label: "軟體公司", applicant: "software_company", source: "receipt", ocr: "company_name" },
  { label: "購買日期", applicant: "purchase_date", source: "receipt", ocr: "purchase_date" },
  { label: "原始費用", applicant: "original_amount", source: "receipt", ocr: "original_amount" },
  { label: "換算新臺幣", applicant: "declared_amount", source: "receipt", ocr: "converted_twd_amount" },
];

function RuleItem({ rule }: { rule: SourceRule }) {
  const flagged = Boolean(rule.result);
  return (
    <details className={cn("rounded-lg border p-3", flagged ? "border-amber-300 bg-amber-50/40" : "border-line")} open={flagged}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs font-semibold">
        <span>{rule.id} · {rule.name}</span><ResultBadge result={rule.disposition} />
      </summary>
      <p className="mt-2 text-xs leading-5">{rule.reason}</p>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        <div><dt className="inline font-semibold">條件：</dt><dd className="inline">{rule.condition}</dd></div>
        <div><dt className="inline font-semibold">資料來源：</dt><dd className="inline">{rule.data_source}</dd></div>
        <div><dt className="inline font-semibold">OCR 欄位：</dt><dd className="inline break-all">{rule.ocr_field ?? "不適用"}</dd></div>
        <div><dt className="inline font-semibold">信心分數：</dt><dd className="inline">{percentage(rule.confidence)}</dd></div>
      </dl>
    </details>
  );
}

function CrossRow({ row }: { row: CrossValidationRow }) {
  return (
    <tr className="border-b border-line align-top">
      <th className="p-2 font-medium">{row.label}</th>
      <td className="p-2"><span className="block text-[10px] text-slate-500">{row.a_source}</span><span className="break-all">{display(row.a_value)}</span></td>
      <td className="p-2"><span className="block text-[10px] text-slate-500">{row.b_source}</span><span className="break-all">{display(row.b_value)}</span></td>
      <td className="p-2"><span className={cn("rounded-full px-2 py-0.5 font-bold", MATCH_STYLE[row.result])}>{row.result}</span></td>
    </tr>
  );
}

/** Reviewer workbench: full rule lineage, cross-validation, OCR evidence, confidence and knowledge-base match. */
export function SourceReviewPanel({ publicId, review }: { publicId: string; review?: SourceReview | null }) {
  const [error, setError] = useState<string | null>(null);
  if (!review) return null;
  const result = review.evaluation;
  const documents = review.documents.filter((doc) => doc.active);
  const kb = result.knowledge_base_data;
  const applicant = { ...(result.applicant_data ?? {}) } as Record<string, unknown>;
  return (
    <Card className="min-w-0 space-y-6 p-5 sm:p-6" data-testid="source-review">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-navy-900">規則引擎判定（RULE-001~020）</h2>
          <ResultBadge result={result.result} />
        </div>
        <p className="mt-2 text-xs leading-6 text-slate-600">{result.policy_notice}</p>
        {result.error ? <Alert tone="warning" className="mt-3">{result.error}</Alert> : null}
        {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
      </div>

      {result.subsidy ? (
        <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6" data-testid="reviewer-subsidy">
          <h3 className="text-sm font-bold text-navy-900">補助金額試算</h3>
          {result.subsidy.unknown ? <p className="mt-1 font-bold text-amber-800">UNKNOWN — 無法確認可採信購買金額，不會算成 0 元，需補件或人工確認。</p> : (
            <p className="mt-1">可採信金額 {money(result.subsidy.eligible_amount)} × 費率 {percentage(result.subsidy.subsidy_rate)} = <strong className="text-sm">補助 {money(result.subsidy.subsidy_amount)}</strong>（上限 {money(result.subsidy.subsidy_cap)}）。金額來源：{result.subsidy.source === "ocr_receipt" ? "憑證 OCR" : "申請人自填（憑證無法判讀，僅供參考，建議人工核對）"}。</p>
          )}
          <p className="text-slate-500">核准時此試算金額成為核定金額；撥款只讀取核准後儲存的金額。</p>
        </div>
      ) : null}

      {result.supplement_center?.items.length ? (
        <div className="rounded-xl border border-orange-200 p-4">
          <h3 className="text-sm font-bold text-orange-900">補件中心 · {result.supplement_center.items.length}</h3>
          {result.supplement_center.deadline ? <p className="mt-1 text-xs text-slate-600">建議補件期限：{result.supplement_center.deadline}</p> : null}
          <ul className="mt-3 space-y-2">{result.supplement_center.items.map((item) => <li key={item.rule_id} className="text-xs leading-5 text-slate-700"><strong>{item.rule_id} · {item.missing_item}</strong><p>{item.reason}</p></li>)}</ul>
        </div>
      ) : null}

      {result.confidence_sources ? (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="confidence-sources">
          <div className="rounded-xl bg-sky-50 p-3 text-xs"><strong>OCR 信心分數</strong>{Object.entries(result.confidence_sources.ocr).map(([key, value]) => <p key={key} className="mt-1">{DOCUMENT_LABELS[key as SourceDocumentType] ?? key}：{percentage(value)}</p>)}</div>
          <div className="rounded-xl bg-teal-50 p-3 text-xs"><strong>知識庫比對</strong><p className="mt-1">{percentage(result.confidence_sources.knowledge_base)}</p><p className="mt-1">依維護清單比對</p></div>
          <div className="rounded-xl bg-violet-50 p-3 text-xs"><strong>規則引擎</strong><p className="mt-1">{percentage(result.confidence_sources.rule_engine)}</p><p className="mt-1">決定性邏輯，非 AI 推論</p></div>
          <p className="text-[11px] text-slate-500 sm:col-span-3">{result.confidence_sources.note}</p>
        </div>
      ) : null}

      {result.rules ? (
        <div>
          <h3 className="text-sm font-bold text-navy-900">審核規則 · {result.rules.length} 項適用（含資料血緣）</h3>
          <div className="mt-3 space-y-2">{result.rules.map((rule) => <RuleItem key={rule.id} rule={rule} />)}</div>
        </div>
      ) : null}

      {result.cross_validation ? (
        <div>
          <h3 className="text-sm font-bold text-navy-900">資料交叉比對矩陣</h3>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line"><th className="p-2">比對項目</th><th className="p-2">來源 A</th><th className="p-2">來源 B</th><th className="p-2">結果</th></tr></thead><tbody>{result.cross_validation.map((row) => <CrossRow key={row.check} row={row} />)}</tbody></table></div>
        </div>
      ) : null}

      {result.ocr_data ? (
        <div>
          <h3 className="text-sm font-bold text-navy-900">申請人填寫 vs AI 擷取</h3>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line"><th className="p-2">欄位</th><th className="p-2">申請人填寫</th><th className="p-2">OCR 擷取</th></tr></thead><tbody>
            {COMPARE_ROWS.map((row) => <tr key={row.label} className="border-b border-line"><th className="p-2 font-medium">{row.label}</th><td className="break-all p-2">{display(applicant[row.applicant])}</td><td className="break-all p-2">{display(result.ocr_data?.[row.source]?.[row.ocr])}</td></tr>)}
          </tbody></table></div>
        </div>
      ) : null}

      {kb ? (
        <div className="rounded-xl border border-line p-4 text-xs leading-6" data-testid="knowledge-base">
          <h3 className="text-sm font-bold text-navy-900">工具知識庫比對</h3>
          {kb.tool ? (
            <p className="mt-1">比對到 <strong>{kb.tool.product_name}</strong>（{kb.tool.company}，{kb.tool.country_or_region}）：{kb.tool.eligible ? "屬於補助範圍" : <span className="font-bold text-red-800">禁止清單 — {kb.tool.prohibited_reason}</span>}。最後確認日期 {kb.tool.last_verified_at}。</p>
          ) : <p className="mt-1 text-amber-800">知識庫未收錄此工具，不可逕自判定合格或不合格，需人工複核。</p>}
          <p>購買來源：{kb.is_aggregator ? `集合式平台/代購網站（${kb.aggregator_name}）` : kb.is_official_source === true ? "官方網站" : kb.is_official_source === false ? "非已知官方網域" : "無法判讀"}</p>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-bold text-navy-900">原始文件 · {documents.length}</h3>
        <div className="mt-3 space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="min-w-0 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><p className="break-all text-xs font-bold text-navy-900">{DOCUMENT_LABELS[doc.document_type]} · {doc.filename}</p><p className="mt-1 text-xs text-slate-600">{OCR_LABELS[doc.ocr_status] ?? doc.ocr_status}</p></div>
                <Button size="sm" variant="outline" onClick={async () => { setError(null); try { await api.downloadSourceDocument(publicId, doc.id, doc.filename, true); } catch (err) { setError(getErrorMessage(err)); } }}><Download className="size-4" /> 下載原始文件</Button>
              </div>
              {doc.ocr_data && Object.keys(doc.ocr_data).length ? <details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-navy-700">檢視擷取欄位與信心分數</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(doc.ocr_data, null, 2)}</pre></details> : null}
            </div>
          ))}
        </div>
      </div>
      <p className="flex items-start gap-2 text-[11px] text-slate-500"><Info className="mt-0.5 size-3.5 shrink-0" /> 信心分數僅供排序與參考，不能取代規則判斷；AI 不會自動核准，所有案件均須由承辦人複核。</p>
    </Card>
  );
}
