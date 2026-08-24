"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileCheck2, FileText, ImageIcon, LoaderCircle, UploadCloud } from "lucide-react";
import { ACCEPTED_RECEIPT_TYPES, MAX_RECEIPT_BYTES } from "@/lib/constants";
import { Alert, Button } from "@/components/ui";
import { cn, getErrorMessage } from "@/lib/utils";

export function ReceiptUploader({ onUpload, disabled }: { onUpload: (file: File) => Promise<void>; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  async function handleFile(file?: File) {
    if (!file || disabled) return;
    setError(null);
    if (!ACCEPTED_RECEIPT_TYPES.includes(file.type)) {
      setError("Choose a PDF, PNG, JPG, or JPEG receipt.");
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setError("The receipt is larger than the 5 MB upload limit.");
      return;
    }
    setFilename(file.name);
    setPhase("uploading");
    const analysisTimer = window.setTimeout(() => setPhase("analyzing"), 550);
    try {
      await onUpload(file);
      setPhase("success");
    } catch (err) {
      setPhase("idle");
      setError(getErrorMessage(err));
    } finally {
      window.clearTimeout(analysisTimer);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  const busy = phase === "uploading" || phase === "analyzing";
  return (
    <div>
      <div
        className={cn(
          "relative flex min-h-52 flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 py-8 text-center",
          dragging ? "border-teal-600 bg-teal-50" : phase === "success" ? "border-emerald-300 bg-emerald-50/60" : "border-slate-300 bg-slate-50 hover:border-navy-400 hover:bg-navy-50/50",
          disabled && "pointer-events-none opacity-60",
        )}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        {busy ? (
          <>
            <span className="grid size-12 place-items-center rounded-xl bg-navy-100 text-navy-700"><LoaderCircle className="size-6 animate-spin" /></span>
            <p className="mt-4 text-sm font-bold text-navy-900">{phase === "uploading" ? "Uploading securely…" : "Analyzing receipt…"}</p>
            <p className="mt-1 text-xs text-slate-500">Extracting provider, product, date, amount, and receipt reference</p>
          </>
        ) : phase === "success" ? (
          <>
            <span className="grid size-12 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><FileCheck2 className="size-6" /></span>
            <p className="mt-4 text-sm font-bold text-emerald-900">Receipt analyzed</p>
            <p className="mt-1 max-w-xs truncate text-xs text-emerald-800">{filename}</p>
            <Button className="mt-4" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>Replace receipt</Button>
          </>
        ) : (
          <>
            <span className="grid size-12 place-items-center rounded-xl bg-navy-100 text-navy-700"><UploadCloud className="size-6" /></span>
            <p className="mt-4 text-sm font-bold text-navy-900">Drop your subscription receipt here</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">PDF, PNG, JPG, or JPEG · Maximum 5 MB</p>
            <Button className="mt-4" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>Choose a file</Button>
            <div className="mt-4 flex gap-3 text-slate-400" aria-hidden="true"><FileText className="size-4" /><ImageIcon className="size-4" /></div>
          </>
        )}
        <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => void handleFile(event.target.files?.[0])} aria-label="Upload subscription receipt" />
      </div>
      {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
      <p className="mt-3 text-[11px] leading-5 text-slate-500">Your file is stored outside the public website. Receipt text is treated only as untrusted evidence and cannot authorize approval or payment.</p>
    </div>
  );
}
