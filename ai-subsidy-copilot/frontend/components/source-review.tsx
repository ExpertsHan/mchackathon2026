"use client";

import { useState } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import type { SourceDocumentType, SourceReview } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

export const DOCUMENT_LABELS: Record<SourceDocumentType, string> = {
  receipt: "購買憑證／繳款證明", id_card: "身分證正反面", passbook: "存摺封面",
  declaration: "切結書", cultural_proof: "特定對象／語言認證證明", payer_declaration: "代付關係與共同切結書",
};
const RESULT_LABELS: Record<string, string> = {
  PASS: "檢查通過", REVIEW: "人工確認", REJECT: "建議退件，待人工決定",
  NEED_SUPPLEMENT: "建議補件", FRAUD_RISK: "疑似異常，待人工查核",
};
const OCR_LABELS: Record<string, string> = {
  done: "辨識完成", failed: "辨識失敗，請重試或人工確認", skipped: "辨識未啟用，需人工確認",
  uploaded: "已上傳，待人工檢視", pending: "辨識中",
};
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "UNKNOWN / 無法確認";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
function percentage(value: number | null | undefined) {
  return value === null || value === undefined ? "無法確認" : `${Math.round(value * 100)}%`;
}

export function SourceReviewPanel({ publicId, review, reviewer = false }: {
  publicId: string; review?: SourceReview | null; reviewer?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!review) return null;
  const result = review.evaluation;
  const activeDocuments = review.documents.filter(doc => doc.active);
  return (
    <Card className="min-w-0 p-5 sm:p-6" data-testid="source-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-navy-900">OCR 來源分析與資料審核</h2>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{RESULT_LABELS[result.result] ?? "尚未分析"}</span>
      </div>
      <p className="mt-3 text-xs leading-6 text-slate-600">{result.policy_notice}</p>
      <p className="mt-1 text-xs leading-6 text-slate-600">{result.documents_required ? "已啟用完整文件審核。補件後會重新比對，最終核定由承辦人確認。" : "目前為收據來源分析。下方可啟用完整文件審核，加入身分與銀行資料比對。"}</p>
      {result.error ? <Alert tone="warning" className="mt-3">{result.error}</Alert> : null}
      {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}

      {result.supplement_center?.items.length ? <details className="mt-4 rounded-xl border border-amber-200 p-4" open={result.documents_required}>
        <summary className="cursor-pointer text-sm font-bold text-amber-900">補件項目 · {result.supplement_center.items.length}</summary>
        {result.documents_required && result.supplement_center.deadline ? <p className="mt-2 text-xs text-slate-600">建議補件期限：{result.supplement_center.deadline}</p> : null}
        <ul className="mt-3 space-y-2">{result.supplement_center.items.map(item => <li key={item.rule_id} className="text-xs leading-5 text-slate-700"><strong>{item.rule_id} · {item.missing_item}</strong><p>{item.reason}</p></li>)}</ul>
      </details> : null}

      <h3 className="mt-5 text-sm font-bold text-navy-900">原始文件 · {activeDocuments.length}</h3>
      <div className="mt-3 space-y-2">{activeDocuments.map(doc => <div key={doc.id} className="min-w-0 rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="break-all text-xs font-bold text-navy-900">{DOCUMENT_LABELS[doc.document_type]} · {doc.filename}</p><p className="mt-1 text-xs text-slate-600">{OCR_LABELS[doc.ocr_status] ?? doc.ocr_status}</p></div>
          <Button size="sm" variant="outline" onClick={async () => { setError(null); try { await api.downloadSourceDocument(publicId, doc.id, doc.filename, reviewer); } catch (err) { setError(getErrorMessage(err)); } }}>下載原始文件</Button></div>
        {reviewer && doc.ocr_data ? <details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-navy-700">檢視擷取欄位與信心分數</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">{display(doc.ocr_data)}</pre></details> : null}
      </div>)}</div>

      {reviewer && result.confidence_sources ? <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-sky-50 p-3 text-xs"><strong>OCR 信心分數</strong>{Object.entries(result.confidence_sources.ocr).map(([key, value]) => <p key={key} className="mt-1">{DOCUMENT_LABELS[key as SourceDocumentType] ?? key}：{percentage(value as number | null)}</p>)}</div>
        <div className="rounded-xl bg-teal-50 p-3 text-xs"><strong>知識庫比對</strong><p className="mt-1">{percentage(result.confidence_sources.knowledge_base)}</p><p className="mt-1">依現有維護清單比對</p></div>
        <div className="rounded-xl bg-violet-50 p-3 text-xs"><strong>規則引擎</strong><p className="mt-1">{percentage(result.confidence_sources.rule_engine)}</p><p className="mt-1">信心分數不代表核准</p></div>
      </div> : null}

      {reviewer && result.cross_validation ? <div className="mt-5"><h3 className="text-sm font-bold text-navy-900">資料交叉比對矩陣</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line"><th className="p-2">比對項目</th><th className="p-2">來源 A</th><th className="p-2">來源 B</th><th className="p-2">結果</th></tr></thead><tbody>{result.cross_validation.map(check => <tr key={check.check} className="border-b border-line align-top"><th className="p-2 font-medium">{check.label}</th><td className="p-2"><span className="block text-[10px] text-slate-500">{check.a_source}</span><span className="break-all">{display(check.a_value)}</span></td><td className="p-2"><span className="block text-[10px] text-slate-500">{check.b_source}</span><span className="break-all">{display(check.b_value)}</span></td><td className="p-2 font-semibold">{check.result}</td></tr>)}</tbody></table></div></div> : null}

      {reviewer && result.rules ? <div className="mt-5"><h3 className="text-sm font-bold text-navy-900">審核規則 · {result.rules.length} 項適用</h3><div className="mt-3 space-y-2">{result.rules.map(rule => <details key={rule.id} className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-xs font-semibold">{rule.id} · {rule.name} · {RESULT_LABELS[rule.disposition]}</summary><p className="mt-2 text-xs leading-5">{rule.reason}</p><dl className="mt-2 space-y-1 text-xs text-slate-600"><div><dt className="inline font-semibold">條件：</dt><dd className="inline">{rule.condition}</dd></div><div><dt className="inline font-semibold">來源：</dt><dd className="inline">{rule.data_source}</dd></div><div><dt className="inline font-semibold">欄位：</dt><dd className="inline break-all">{rule.ocr_field ?? "不適用"}</dd></div><div><dt className="inline font-semibold">信心分數：</dt><dd className="inline">{percentage(rule.confidence)}</dd></div></dl></details>)}</div></div> : null}

      {reviewer && result.subsidy ? <div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-6"><h3 className="font-bold">OCR 政策參考試算</h3><p>{result.subsidy.unknown ? "金額無法確認，待補件或人工確認。" : `参考補助 NT$${result.subsidy.subsidy_amount?.toLocaleString()}；費率 ${percentage(result.subsidy.subsidy_rate)}；上限 NT$${result.subsidy.subsidy_cap?.toLocaleString()}`}</p><p>來源：{result.subsidy.source ?? "UNKNOWN"}。實際核定金額請看 Copilot 資格檢查與撥款欄位。</p></div> : null}
      {reviewer ? <div className="mt-5 grid gap-3 lg:grid-cols-3">{[
        ["申請人填寫資料", result.applicant_data], ["OCR 擷取資料", result.ocr_data], ["工具知識庫比對", result.knowledge_base_data],
      ].map(([label, value]) => <details key={String(label)} className="min-w-0 rounded-lg border border-line p-3"><summary className="cursor-pointer text-xs font-bold">{String(label)}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{display(value)}</pre></details>)}</div> : null}
    </Card>
  );
}
