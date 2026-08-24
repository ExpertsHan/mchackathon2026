import { AlertTriangle, Check, Circle, Scale, X } from "lucide-react";
import type { EligibilityResult } from "@/lib/types";
import { Card } from "@/components/ui";
import { RiskBadge } from "@/components/status-badge";
import { cn, formatCurrency, humanize } from "@/lib/utils";

export function EligibilityChecklist({ result, title = "Eligibility check" }: { result: EligibilityResult; title?: string }) {
  const risk = result.risk_level ?? (result.requires_manual_review ? "HIGH" : "LOW");
  const displayedAmount = result.provisional ? result.estimated_amount_twd : result.approved_amount_twd;
  return (
    <Card className="overflow-hidden shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-slate-50 px-4 py-3.5">
        <div className="flex items-center gap-2"><Scale className="size-4 text-teal-700" /><h3 className="text-sm font-bold text-navy-900">{title}</h3></div>
        <RiskBadge risk={risk} />
      </div>
      <ul className="divide-y divide-line px-4">
        {result.checks.map((check) => {
          const isPendingSafety = result.provisional && check.rule === "SAFETY_TRAINING_COMPLETED";
          return (
            <li className="flex items-start gap-3 py-3.5" key={check.rule}>
              <span className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                check.passed === true
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : isPendingSafety
                    ? "border-amber-500 bg-amber-50 text-amber-700"
                    : check.passed === false
                      ? "border-red-500 bg-red-50 text-red-700"
                      : "border-slate-300 bg-white text-slate-400",
              )}>
                {check.passed === true
                  ? <Check className="size-3" strokeWidth={3} />
                  : isPendingSafety
                    ? <Circle className="size-2 fill-current" />
                    : check.passed === false
                      ? <X className="size-3" strokeWidth={3} />
                      : <Circle className="size-2 fill-current" />}
              </span>
              <div className="min-w-0"><p className="text-xs font-extrabold text-navy-900">{humanize(check.rule)}</p><p className="mt-1 text-xs leading-5 text-slate-600">{check.message}</p></div>
            </li>
          );
        })}
      </ul>
      <div className={cn("border-t px-4 py-4", result.provisional || result.requires_manual_review ? "border-amber-200 bg-amber-50" : result.eligible ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-slate-600">Result</p>
            <p className="mt-1 text-sm font-bold text-navy-900">
              {result.provisional ? "Provisionally eligible — AI Safety Training remains required" : result.requires_manual_review ? "Human review required" : result.eligible ? "Eligible" : "Not automatically eligible"}
            </p>
          </div>
          <div className="text-right"><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-slate-600">{result.provisional ? "Estimated subsidy" : "Approved subsidy"}</p><p className="mt-1 text-xl font-extrabold text-navy-900">{formatCurrency(displayedAmount)}</p></div>
        </div>
        {result.requires_manual_review && result.risk_reasons?.length ? (
          <div className="mt-3 flex gap-2 text-xs leading-5 text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{result.risk_reasons.join(" · ")}</span></div>
        ) : null}
        <p className="mt-3 border-t border-current/10 pt-3 text-[10px] text-slate-500">Foreign-currency amounts use fixed demo rates: USD × 30 and EUR × 32. These are mock rates, not live financial data.</p>
      </div>
    </Card>
  );
}
