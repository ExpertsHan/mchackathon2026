import { CheckCircle2, Landmark, LockKeyhole, WalletCards } from "lucide-react";
import type { Application } from "@/lib/types";
import { Card } from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function PaymentPanel({ application }: { application: Application }) {
  const payment = application.payment;
  const paid = application.status === "PAID" || payment?.status === "PAID";
  const scheduled = application.status === "PAYMENT_SCHEDULED" || payment?.status === "PAYMENT_SCHEDULED";
  const approved = application.status === "APPROVED";
  return (
    <Card className="overflow-hidden shadow-none">
      <div className="flex items-center gap-3 border-b border-line bg-slate-50 px-4 py-3.5"><span className="grid size-9 place-items-center rounded-lg bg-teal-50 text-teal-700"><WalletCards className="size-5" /></span><div><h3 className="text-sm font-bold text-navy-900">Mock treasury payment</h3><p className="text-[11px] text-slate-500">No real funds are transferred</p></div></div>
      <div className="p-4">
        <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-slate-500">Payment amount</p><p className="mt-1 text-2xl font-extrabold text-navy-900">{formatCurrency(payment?.amount_twd ?? application.approved_amount_twd)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${paid ? "bg-emerald-100 text-emerald-800" : scheduled ? "bg-violet-100 text-violet-800" : approved ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}>{paid ? "Paid" : scheduled ? "Scheduled" : approved ? "Ready to schedule" : "Not available"}</span></div>
        {payment?.transaction_id ? <div className="mt-4 rounded-lg border border-line bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Transaction ID</p><p className="mt-1 break-all font-mono text-sm font-bold text-navy-900">{payment.transaction_id}</p></div> : null}
        {payment?.paid_at || payment?.scheduled_at ? <p className="mt-3 text-xs text-slate-500">{paid ? "Completed" : "Scheduled"} {formatDateTime(payment.paid_at ?? payment.scheduled_at)}</p> : null}
        <div className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-[11px] leading-5 text-slate-500">{paid ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" /> : application.status === "APPROVED" ? <Landmark className="mt-0.5 size-4 shrink-0 text-navy-700" /> : <LockKeyhole className="mt-0.5 size-4 shrink-0 text-slate-500" />} Payment can only be initiated server-side after the application reaches APPROVED.</div>
      </div>
    </Card>
  );
}
