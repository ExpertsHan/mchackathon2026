import { Check } from "lucide-react";
import { APPLICATION_STEPS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ProgressIndicator({ currentStep, completedSteps }: { currentStep: number; completedSteps: number[] }) {
  return (
    <nav aria-label="Application progress" className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
      <ol className="grid grid-cols-6">
        {APPLICATION_STEPS.map((step, index) => {
          const number = index + 1;
          const complete = completedSteps.includes(number);
          const current = currentStep === number;
          return (
            <li key={step.key} className="relative flex min-w-0 flex-col items-center text-center" aria-current={current ? "step" : undefined}>
              {index > 0 ? <span className={cn("absolute right-1/2 top-3.5 h-0.5 w-full", complete || current ? "bg-teal-600" : "bg-slate-200")} aria-hidden="true" /> : null}
              <span className={cn(
                "relative z-10 grid size-7 place-items-center rounded-full border-2 text-xs font-extrabold",
                complete ? "border-teal-700 bg-teal-700 text-white" : current ? "border-navy-700 bg-white text-navy-800 ring-4 ring-navy-50" : "border-slate-300 bg-white text-slate-400",
              )}>
                {complete ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : number}
              </span>
              <span className={cn("mt-2 hidden truncate text-[11px] font-bold sm:block", current || complete ? "text-navy-800" : "text-slate-400")}>{step.label}</span>
              <span className={cn("mt-2 truncate text-[9px] font-bold sm:hidden", current || complete ? "text-navy-800" : "text-slate-400")}>{step.shortLabel}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function CompactProgress({ labels }: { labels: Array<{ label: string; complete: boolean; detail?: string }> }) {
  return (
    <div className="space-y-3">
      {labels.map((item) => (
        <div className="flex items-center justify-between gap-3" key={item.label}>
          <div className="flex items-center gap-2.5 text-sm">
            <span className={cn("grid size-5 place-items-center rounded-full border", item.complete ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent")}><Check className="size-3" strokeWidth={3} /></span>
            <span className={cn("font-semibold", item.complete ? "text-navy-900" : "text-slate-500")}>{item.label}</span>
          </div>
          {item.detail ? <span className="text-xs font-semibold text-slate-500">{item.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}
