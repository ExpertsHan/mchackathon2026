"use client";

import { useState } from "react";
import { Alert, Button, Card, FieldLabel } from "@/components/ui";
import { DOCUMENT_LABELS } from "@/components/source-review";
import { api } from "@/lib/api";
import type { SourceApplicant, SourceDocumentType, SourceReview } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function SourceIntake({ publicId, review, onUpdated }: {
  publicId: string; review?: SourceReview | null; onUpdated: () => Promise<void>;
}) {
  const [form, setForm] = useState<SourceApplicant>(() => ({
    applicant_type: "normal", payment_type: "monthly", software_category: "general",
    is_own_credit_card: true, ...review?.applicant_data,
  }));
  const [type, setType] = useState<SourceDocumentType>("id_card");
  const [files, setFiles] = useState<File[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(action: string, work: () => Promise<unknown>) {
    setBusy(action); setError(null); setNotice(null);
    try { await work(); await onUpdated(); setNotice("資料已儲存，來源分析已更新。"); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setBusy(null); }
  }
  return <Card className="p-5 sm:p-6">
    <h2 className="text-lg font-bold text-navy-900">文件來源資料與補件</h2>
    <p className="mt-2 text-xs leading-6 text-slate-600">填寫原始申請資料，再加入身分證、繳款證明、存摺與切結書，讓承辦人交叉核對。儲存資料或上傳文件會啟用完整文件審核，送件後須經人工確認。</p>
    {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
    {notice ? <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p> : null}
    <form className="mt-4" onSubmit={event => { event.preventDefault(); void run("save", () => api.saveSourceData(publicId, form)); }}>
      <fieldset disabled={busy !== null} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><FieldLabel htmlFor="source-birth">出生日期</FieldLabel><input id="source-birth" type="date" className={fieldClass} value={form.birth_date ?? ""} onChange={e => setForm({ ...form, birth_date: e.target.value || null })} /></div>
        <div><FieldLabel htmlFor="source-purchase">申報購買日期</FieldLabel><input id="source-purchase" type="date" className={fieldClass} value={form.purchase_date ?? ""} onChange={e => setForm({ ...form, purchase_date: e.target.value || null })} /></div>
        <div><FieldLabel htmlFor="source-amount">申報新臺幣購買金額</FieldLabel><input id="source-amount" type="number" min="0.01" max="1000000" step="0.01" className={fieldClass} value={form.declared_amount ?? ""} onChange={e => setForm({ ...form, declared_amount: e.target.value ? Number(e.target.value) : null })} /></div>
        <div><FieldLabel htmlFor="source-category">申請身分</FieldLabel><select id="source-category" className={fieldClass} value={form.applicant_type} onChange={e => setForm({ ...form, applicant_type: e.target.value as SourceApplicant["applicant_type"] })}><option value="normal">一般身分</option><option value="special">特定對象</option><option value="language">文化語言保存者</option></select></div>
        <div><FieldLabel htmlFor="source-plan">繳費制度</FieldLabel><select id="source-plan" className={fieldClass} value={form.payment_type} onChange={e => setForm({ ...form, payment_type: e.target.value as SourceApplicant["payment_type"] })}><option value="monthly">月費制</option><option value="annual">年費制</option></select></div>
        <div><FieldLabel htmlFor="source-tool-category">工具分類</FieldLabel><select id="source-tool-category" className={fieldClass} value={form.software_category} onChange={e => setForm({ ...form, software_category: e.target.value as SourceApplicant["software_category"] })}><option value="general">通用型</option><option value="image">影像設計</option><option value="office">辦公應用</option><option value="learning">學習研究</option><option value="other">其他</option></select></div>
        <div className="sm:col-span-2"><FieldLabel htmlFor="source-address">戶籍地址</FieldLabel><input id="source-address" maxLength={300} className={fieldClass} value={form.household_address ?? ""} onChange={e => setForm({ ...form, household_address: e.target.value || null })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_own_credit_card} onChange={e => setForm({ ...form, is_own_credit_card: e.target.checked })} />使用本人信用卡付款</label>
      </fieldset>
      <Button type="submit" className="mt-4" disabled={busy !== null} loading={busy === "save"}>{review?.evaluation.documents_required ? "儲存並重新比對" : "啟用完整文件審核"}</Button>
    </form>
    <form className="mt-6 border-t border-line pt-5" onSubmit={event => { event.preventDefault(); void run("upload", async () => { await api.uploadSourceDocuments(publicId, type, files, replace); setFiles([]); }); }}>
      <fieldset disabled={busy !== null} className="space-y-4">
        <div><FieldLabel htmlFor="source-doc-type">文件類型</FieldLabel><select id="source-doc-type" className={fieldClass} value={type} onChange={e => { setType(e.target.value as SourceDocumentType); setReplace(false); }}>{Object.entries(DOCUMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><FieldLabel htmlFor="source-doc-files">選擇文件，可同時上傳多張</FieldLabel><input id="source-doc-files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg" className={fieldClass} onChange={e => setFiles(Array.from(e.target.files ?? []))} /><p className="mt-1 text-xs text-slate-500">每次 1–5 份，每份最多 5 MB。購買憑證可附加信用卡帳單或扣款證明。</p></div>
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} className="mt-1" />以這次上傳取代同類補充文件（原檔與紀錄保留）。身分證正反面請一起選取。</label>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy !== null || !files.length || files.length > 5} loading={busy === "upload"}>上傳並分析文件</Button><Button type="button" variant="outline" disabled={busy !== null} loading={busy === "analyze"} onClick={() => void run("analyze", () => api.analyzeSources(publicId))}>重新比對現有資料</Button></div>
      </fieldset>
    </form>
  </Card>;
}
