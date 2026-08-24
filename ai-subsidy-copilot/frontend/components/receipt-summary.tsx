import { Calendar, Check, CircleDollarSign, FileDigit, Mail, PackageCheck, Receipt, ShieldAlert } from "lucide-react";
import type { Subscription } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { formatDate, formatReceiptAmount } from "@/lib/utils";

const fieldRows = (subscription: Subscription) => [
  { icon: PackageCheck, label: "Provider", value: subscription.provider || "Not identified" },
  { icon: Receipt, label: "Product", value: subscription.product || "Not identified" },
  { icon: CircleDollarSign, label: "Amount", value: formatReceiptAmount(subscription.amount, subscription.currency) },
  { icon: Calendar, label: "Purchase date", value: formatDate(subscription.purchase_date) },
  { icon: FileDigit, label: "Receipt ID", value: subscription.receipt_reference || "Not found" },
  { icon: Mail, label: "Account", value: subscription.account_email || "Not shown" },
];

export function ReceiptSummary({ subscription, confirmed, onConfirm }: { subscription: Subscription; confirmed?: boolean; onConfirm?: () => void }) {
  const confidence = subscription.extraction_confidence;
  return (
    <Card className="overflow-hidden shadow-none">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-slate-50 px-4 py-3">
        <div><h3 className="text-sm font-bold text-navy-900">Extracted receipt details</h3><p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">{subscription.receipt_filename ?? "Uploaded receipt"}</p></div>
        {confidence !== null && confidence !== undefined ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600">{Math.round(confidence * 100)}% confidence</span> : null}
      </div>
      <dl className="divide-y divide-line px-4">
        {fieldRows(subscription).map(({ icon: Icon, label, value }) => (
          <div className="grid grid-cols-[1fr_1.15fr] gap-3 py-3 text-xs" key={label}>
            <dt className="flex items-center gap-2 text-slate-500"><Icon className="size-4" aria-hidden="true" />{label}</dt>
            <dd className="break-words text-right font-bold text-navy-900">{value}</dd>
          </div>
        ))}
      </dl>
      {onConfirm ? (
        <div className="border-t border-line bg-slate-50 p-4">
          <Button className="w-full" variant={confirmed ? "secondary" : "primary"} onClick={onConfirm} disabled={confirmed}>
            <Check className="size-4" /> {confirmed ? "Details confirmed" : "These details look right"}
          </Button>
        </div>
      ) : null}
      {confidence !== null && confidence !== undefined && confidence < 0.7 ? (
        <div className="flex gap-2 border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Low-confidence extraction will be sent to a human reviewer, not automatically rejected.</div>
      ) : null}
    </Card>
  );
}
