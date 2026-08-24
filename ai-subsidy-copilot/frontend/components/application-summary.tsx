import { BadgeCheck, Bot, Calendar, GraduationCap, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import type { Application, DemoUser, EligibilityResult, SafetyProgress, Subscription } from "@/lib/types";
import { Card } from "@/components/ui";
import { EligibilityChecklist } from "@/components/eligibility-checklist";
import { formatCurrency, formatDate, formatReceiptAmount } from "@/lib/utils";

export function ApplicationSummary({
  user,
  subscription,
  eligibility,
  safetyProgress,
  application,
  compact = false,
}: {
  user?: DemoUser | null;
  subscription?: Subscription | null;
  eligibility?: EligibilityResult | null;
  safetyProgress?: SafetyProgress | null;
  application?: Application | null;
  compact?: boolean;
}) {
  const rows = [
    { icon: BadgeCheck, label: "Applicant", value: user?.name ?? application?.user?.name ?? application?.applicant?.name ?? "—", detail: user?.government_id_masked },
    { icon: Bot, label: "AI subscription", value: subscription?.product ?? application?.subscription?.product ?? "Not selected", detail: subscription?.provider ?? application?.subscription?.provider },
    { icon: ReceiptText, label: "Receipt amount", value: formatReceiptAmount(subscription?.amount ?? application?.subscription?.amount, subscription?.currency ?? application?.subscription?.currency), detail: subscription?.purchase_date ? formatDate(subscription.purchase_date) : undefined },
    { icon: WalletCards, label: eligibility?.eligible ? "Approved subsidy" : "Estimated subsidy", value: formatCurrency(eligibility ? (eligibility.provisional ? eligibility.estimated_amount_twd : eligibility.approved_amount_twd) : application?.approved_amount_twd ?? application?.requested_amount_twd), detail: "Maximum NT$600" },
    { icon: GraduationCap, label: "AI safety training", value: safetyProgress?.complete ? "Completed" : `${safetyProgress?.completed_count ?? 0} / ${safetyProgress?.required_count ?? 4} complete`, detail: safetyProgress?.complete ? "All required modules" : "Required before submission" },
  ];
  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      <Card className="overflow-hidden shadow-none">
        <div className="flex items-center justify-between border-b border-line bg-slate-50 px-4 py-3.5"><h3 className="text-sm font-bold text-navy-900">Application summary</h3>{application?.public_id ? <span className="font-mono text-[11px] font-bold text-slate-500">{application.public_id}</span> : null}</div>
        <dl className="divide-y divide-line px-4">
          {rows.map(({ icon: Icon, label, value, detail }) => (
            <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-3.5" key={label}>
              <dt className="flex items-center gap-2 text-xs text-slate-500"><Icon className="size-4" aria-hidden="true" />{label}</dt>
              <dd className="text-right"><span className="block text-sm font-bold text-navy-900">{value}</span>{detail ? <span className="mt-0.5 block text-[10px] text-slate-500">{detail}</span> : null}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-start gap-2 border-t border-navy-100 bg-navy-50 px-4 py-3 text-[11px] leading-5 text-navy-800"><ShieldCheck className="mt-0.5 size-4 shrink-0" /> Final eligibility and payment authorization are performed by backend services, never by the AI assistant.</div>
      </Card>
      {!compact && eligibility ? <EligibilityChecklist result={eligibility} title="Final rule check" /> : null}
    </div>
  );
}

export function KeyValueGrid({ items }: { items: Array<{ label: string; value: React.ReactNode; icon?: typeof Calendar }> }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
      {items.map(({ label, value, icon: Icon }) => (
        <div className="bg-white p-4" key={label}><dt className="flex items-center gap-2 text-xs font-semibold text-slate-500">{Icon ? <Icon className="size-3.5" /> : null}{label}</dt><dd className="mt-1.5 break-words text-sm font-bold text-navy-900">{value}</dd></div>
      ))}
    </dl>
  );
}
