"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { ACCEPTED_DOCUMENT_EXTENSIONS, DOCUMENT_HINTS, MAX_DOCUMENT_BYTES } from "@/lib/constants";
import { api } from "@/lib/api";
import type { RequiredDocument, SourceDocumentType, SourceReview } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

export const OCR_LABELS: Record<string, string> = {
  done: "已辨識", failed: "辨識失敗，請補上更清楚的檔案", skipped: "辨識未啟用，由承辦人檢視原檔",
  uploaded: "已上傳", pending: "辨識中",
};

function Slot({ publicId, item, review, disabled, onUpdated }: {
  publicId: string; item: RequiredDocument; review: SourceReview; disabled?: boolean; onUpdated: (review: SourceReview) => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploaded = review.documents.filter((doc) => doc.document_type === item.document_type && doc.active);

  function choose(list: FileList | null) {
    const next = Array.from(list ?? []);
    setError(null);
    if (next.length > 5) return setError("每次最多上傳 5 個檔案。");
    const tooBig = next.find((file) => file.size > MAX_DOCUMENT_BYTES);
    if (tooBig) return setError(`「${tooBig.name}」超過 10 MB，請壓縮後再上傳。`);
    setFiles(next);
  }

  async function upload() {
    if (!files.length) return setError("請先選擇檔案。");
    setBusy(true); setError(null);
    try {
      const updated = await api.uploadSourceDocuments(publicId, item.document_type as SourceDocumentType, files);
      setFiles([]);
      if (input.current) input.current.value = "";
      await onUpdated(updated);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <li className="rounded-xl border border-line p-4" data-testid={`slot-${item.document_type}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy-900">{item.label}</h3>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", uploaded.length ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>
          {uploaded.length ? <CheckCircle2 className="size-3.5" /> : null}
          {uploaded.length ? (item.multiple ? `已上傳 ${uploaded.length} 張` : "已上傳") : "尚未上傳"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{DOCUMENT_HINTS[item.document_type]}</p>
      {uploaded.length ? (
        <ul className="mt-3 space-y-1.5">
          {uploaded.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="min-w-0 break-all font-medium text-navy-900">{doc.filename}<span className="ml-2 font-normal text-slate-500">{OCR_LABELS[doc.ocr_status] ?? doc.ocr_status}</span></span>
              <button type="button" className="inline-flex items-center gap-1 font-bold text-navy-700 hover:underline" onClick={() => api.downloadSourceDocument(publicId, doc.id, doc.filename).catch((err) => setError(getErrorMessage(err)))}><Download className="size-3.5" /> 下載</button>
            </li>
          ))}
        </ul>
      ) : null}
      {!disabled ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" aria-label={`選擇${item.label}檔案`} accept={ACCEPTED_DOCUMENT_EXTENSIONS} multiple={item.multiple} onChange={(e) => choose(e.target.files)} className="max-w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-navy-800" />
          <Button size="sm" variant="outline" onClick={upload} disabled={busy || !files.length}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} {busy ? "辨識中…" : uploaded.length && !item.multiple ? "重新上傳" : "上傳"}
          </Button>
        </div>
      ) : null}
      {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
    </li>
  );
}

export function DocumentUploader({ publicId, review, disabled, onUpdated }: {
  publicId: string; review: SourceReview; disabled?: boolean; onUpdated: (review: SourceReview) => void | Promise<void>;
}) {
  return (
    <ul className="space-y-3" aria-label="申請文件">
      {review.required_documents.map((item) => <Slot key={item.document_type} publicId={publicId} item={item} review={review} disabled={disabled} onUpdated={onUpdated} />)}
    </ul>
  );
}
