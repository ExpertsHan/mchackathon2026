"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { CheckCircle2, CircleDollarSign, ClipboardCheck, Info, MessageSquareMore, X, XCircle } from "lucide-react";
import type { Application, ApplicationStatus } from "@/lib/types";
import { Alert, Button, FieldLabel } from "@/components/ui";
import { api } from "@/lib/api";
import { getErrorMessage, humanize } from "@/lib/utils";

type ReviewAction = "approve" | "reject" | "request-info";

const dialogCopy: Record<ReviewAction, { title: string; description: string; button: string; variant: "primary" | "danger" | "outline" }> = {
  approve: { title: "Approve application", description: "Confirm why this application may proceed. Any risk override is recorded in the audit trail.", button: "Approve", variant: "primary" },
  reject: { title: "Reject application", description: "Give the citizen a concise reason based on policy or evidence. Rejection is a final state.", button: "Reject", variant: "danger" },
  "request-info": { title: "Request more information", description: "Explain exactly what evidence or clarification the citizen needs to provide.", button: "Send request", variant: "outline" },
};

function canReview(status: ApplicationStatus) {
  return ["VERIFYING", "MANUAL_REVIEW"].includes(status);
}

export function ReviewerActions({ application, onUpdated }: { application: Application; onUpdated: () => void | Promise<void> }) {
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [overrideReviewFlag, setOverrideReviewFlag] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reviewAllowed = canReview(application.status);
  const verifyAllowed = ["SUBMITTED", "VERIFYING", "MANUAL_REVIEW"].includes(application.status);
  const paymentAllowed = ["APPROVED", "PAYMENT_SCHEDULED"].includes(application.status);

  async function runVerification() {
    setLoading("verify"); setError(null);
    try { await api.runVerification(application.public_id); await onUpdated(); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(null); }
  }

  async function processPayment() {
    setLoading("payment"); setError(null);
    try { await api.processPayment(application.public_id); await onUpdated(); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(null); }
  }

  async function submitReview() {
    if (!action || !reason.trim()) return;
    setLoading(action); setError(null);
    try {
      await api.reviewAction(application.public_id, action, reason.trim(), overrideReviewFlag);
      setAction(null); setReason(""); setOverrideReviewFlag(false); await onUpdated();
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(null); }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {verifyAllowed ? <Button variant="outline" onClick={runVerification} loading={loading === "verify"}><ClipboardCheck className="size-4" /> Run verification</Button> : null}
        {reviewAllowed ? <><Button onClick={() => setAction("approve")}><CheckCircle2 className="size-4" /> Approve</Button>{application.status === "MANUAL_REVIEW" ? <Button variant="outline" onClick={() => setAction("request-info")}><MessageSquareMore className="size-4" /> Request information</Button> : null}<Button variant="danger" onClick={() => setAction("reject")}><XCircle className="size-4" /> Reject</Button></> : null}
        {paymentAllowed ? <Button variant="secondary" onClick={processPayment} loading={loading === "payment"}><CircleDollarSign className="size-4" /> {application.status === "PAYMENT_SCHEDULED" ? "Complete payment" : "Process payment"}</Button> : null}
        {!verifyAllowed && !reviewAllowed && !paymentAllowed ? <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600"><Info className="size-4" /> No actions available in {humanize(application.status)}</span> : null}
      </div>
      {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}

      <Dialog.Root open={action !== null} onOpenChange={(open) => { if (!open) { setAction(null); setReason(""); setOverrideReviewFlag(false); } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/55 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-6 shadow-float focus:outline-none">
            {action ? <><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-xl font-bold text-navy-900">{dialogCopy[action].title}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">{dialogCopy[action].description}</Dialog.Description></div><Dialog.Close className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="size-4" /></Dialog.Close></div>
              <div className="mt-5"><FieldLabel htmlFor="review-reason">Reviewer reason <span className="text-red-700">*</span></FieldLabel><textarea id="review-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="State the evidence and policy basis for this action…" className="w-full resize-none rounded-xl border border-slate-300 p-3 text-sm leading-6 text-navy-900 shadow-sm placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-3 focus:ring-sky-500/15" /><p className="mt-1.5 text-[11px] text-slate-500">This reason is persisted and added to the append-only audit trail.</p></div>
              {action === "approve" && application.status === "MANUAL_REVIEW" ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5"><input type="checkbox" className="mt-1 size-4 rounded border-amber-400 accent-navy-700" checked={overrideReviewFlag} onChange={(event) => setOverrideReviewFlag(event.target.checked)} /><span className="text-xs leading-5 text-amber-950"><strong className="block">Confirm review-flag override</strong>I reviewed the evidence and accept accountability for overriding the non-blocking risk flag. Mandatory policy failures remain impossible to override.</span></label> : null}
              <div className="mt-6 flex justify-end gap-2"><Dialog.Close asChild><Button variant="ghost">Cancel</Button></Dialog.Close><Button variant={dialogCopy[action].variant} disabled={!reason.trim() || (action === "approve" && application.status === "MANUAL_REVIEW" && !overrideReviewFlag)} loading={loading === action} onClick={submitReview}>{dialogCopy[action].button}</Button></div></> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
