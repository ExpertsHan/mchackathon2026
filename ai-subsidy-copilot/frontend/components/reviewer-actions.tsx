"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleDollarSign, ClipboardCheck, Flag, Info, MessageSquareMore, Send, X, XCircle } from "lucide-react";
import type { Application } from "@/lib/types";
import { Alert, Button, FieldLabel, inputClassName } from "@/components/ui";
import { api } from "@/lib/api";
import { readReviewerName, saveReviewerName } from "@/lib/reviewer";
import { getErrorMessage, humanize } from "@/lib/utils";

type DialogAction = "approve" | "reject" | "request-info" | "flag-check" | "notify";

const dialogCopy: Record<DialogAction, { title: string; description: string; button: string; variant: "primary" | "danger" | "outline"; placeholder: string }> = {
  approve: { title: "通過（核准）", description: "核准後，規則引擎的試算金額成為核定金額，可進入撥款。任何風險覆寫都會寫入稽核紀錄。", button: "核准", variant: "primary", placeholder: "請寫明核對過的證據與政策依據…" },
  reject: { title: "退件", description: "請以政策或證據為依據，簡述退件理由。退件為最終狀態。", button: "退件", variant: "danger", placeholder: "請寫明退件的政策依據…" },
  "request-info": { title: "要求補件", description: "請明確說明申請人需要補充的文件或說明；申請人會收到通知。", button: "送出補件要求", variant: "outline", placeholder: "例如：請補上身分證背面，需清楚顯示新竹市地址…" },
  "flag-check": { title: "標記需要進一步查核", description: "不改變案件狀態，只標記此案需要更深入的查核，並記錄原因。", button: "標記", variant: "outline", placeholder: "請寫明需要進一步查核的原因…" },
  notify: { title: "LINE 推播給申請人", description: "透過 LINE 傳送一則自訂訊息，需申請人已綁定 LINE。", button: "推播", variant: "primary", placeholder: "訊息內容…" },
};

export function ReviewerActions({ application, onUpdated }: { application: Application; onUpdated: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [action, setAction] = useState<DialogAction | null>(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { const timer = window.setTimeout(() => setName(readReviewerName()), 0); return () => window.clearTimeout(timer); }, []);

  const status = application.status;
  const inReview = status === "MANUAL_REVIEW";
  const rejectAllowed = inReview || status === "REQUESTED_INFORMATION";
  const verifyAllowed = ["SUBMITTED", "VERIFYING", "MANUAL_REVIEW"].includes(status);
  const paymentAllowed = ["APPROVED", "PAYMENT_SCHEDULED"].includes(status);
  // Anything the engine flagged (not a clean PASS) needs an explicit, audited override.
  const flagged = (application.source_review?.evaluation.result ?? "REVIEW") !== "PASS";
  const reviewer = name.trim();

  function rename(value: string) { setName(value); saveReviewerName(value.trim()); }
  function close() { setAction(null); setReason(""); setOverride(false); }

  async function run(key: string, work: () => Promise<unknown>) {
    if (!reviewer) { setError("請先填寫承辦人姓名，操作會記錄在稽核時間軸。"); return false; }
    setLoading(key); setError(null); setNotice(null);
    try { await work(); await onUpdated(); return true; }
    catch (err) { setError(getErrorMessage(err)); return false; }
    finally { setLoading(null); }
  }

  async function submitDialog() {
    if (!action || !reason.trim()) return;
    const ok = await run(action, async () => {
      if (action === "notify") { const result = await api.notifyApplicant(application.public_id, reviewer, reason.trim()); setNotice(result.message); }
      else await api.reviewAction(application.public_id, action, reviewer, reason.trim(), override);
    });
    if (ok) close();
  }

  const approveBlocked = action === "approve" && flagged && !override;
  return (
    <div>
      <div className="mb-3 max-w-xs">
        <FieldLabel htmlFor="reviewer-name">承辦人姓名 <span className="text-red-700">*</span></FieldLabel>
        <input id="reviewer-name" className={inputClassName} value={name} maxLength={60} placeholder="例如：王承辦" onChange={(event) => rename(event.target.value)} />
        <p className="mt-1 text-[11px] text-slate-500">僅記錄於稽核紀錄（本機記住），不是登入驗證。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {verifyAllowed ? <Button variant="outline" onClick={() => run("verify", () => api.runVerification(application.public_id, reviewer))} loading={loading === "verify"}><ClipboardCheck className="size-4" /> 重新檢查</Button> : null}
        {inReview ? <><Button onClick={() => setAction("approve")}><CheckCircle2 className="size-4" /> ✅ 通過</Button><Button variant="outline" onClick={() => setAction("request-info")}><MessageSquareMore className="size-4" /> 📋 補件</Button><Button variant="outline" onClick={() => setAction("flag-check")}><Flag className="size-4" /> 🔍 需要進一步查核</Button></> : null}
        {rejectAllowed ? <Button variant="danger" onClick={() => setAction("reject")}><XCircle className="size-4" /> ❌ 退件</Button> : null}
        {paymentAllowed ? <Button variant="secondary" onClick={() => run("payment", () => api.processPayment(application.public_id, reviewer))} loading={loading === "payment"}><CircleDollarSign className="size-4" /> {status === "PAYMENT_SCHEDULED" ? "完成撥款" : "撥款"}</Button> : null}
        {status !== "DRAFT" ? <Button variant="ghost" onClick={() => setAction("notify")}><Send className="size-4" /> LINE 推播</Button> : null}
        {!verifyAllowed && !rejectAllowed && !paymentAllowed ? <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600"><Info className="size-4" /> No actions available in {humanize(status)}</span> : null}
      </div>
      {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
      {notice ? <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

      <Dialog.Root open={action !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/55 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-6 shadow-float focus:outline-none">
            {action ? <>
              <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-xl font-bold text-navy-900">{dialogCopy[action].title}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">{dialogCopy[action].description}</Dialog.Description></div><Dialog.Close className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="size-4" /></Dialog.Close></div>
              <p className="mt-3 text-xs text-slate-500">承辦人：<strong>{reviewer || "（尚未填寫）"}</strong></p>
              <div className="mt-4"><FieldLabel htmlFor="review-reason">{action === "notify" ? "訊息" : "理由"} <span className="text-red-700">*</span></FieldLabel><textarea id="review-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder={dialogCopy[action].placeholder} className="w-full resize-none rounded-xl border border-slate-300 p-3 text-sm leading-6 text-navy-900 shadow-sm placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-3 focus:ring-sky-500/15" />{action !== "notify" ? <p className="mt-1.5 text-[11px] text-slate-500">此理由與承辦人姓名會寫入僅可附加的稽核紀錄。</p> : null}</div>
              {action === "approve" && flagged ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5"><input type="checkbox" className="mt-1 size-4 rounded border-amber-400 accent-navy-700" checked={override} onChange={(event) => setOverride(event.target.checked)} /><span className="text-xs leading-5 text-amber-950"><strong className="block">確認覆寫規則引擎的標記</strong>規則引擎對此案標記為 {application.source_review?.evaluation.result ?? "REVIEW"}。我已核對證據並承擔覆寫責任；被標記的規則會記錄在稽核紀錄中。</span></label> : null}
              <div className="mt-6 flex justify-end gap-2"><Dialog.Close asChild><Button variant="ghost">取消</Button></Dialog.Close><Button variant={dialogCopy[action].variant} disabled={!reason.trim() || !reviewer || approveBlocked} loading={loading === action} onClick={submitDialog}>{dialogCopy[action].button}</Button></div>
            </> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
