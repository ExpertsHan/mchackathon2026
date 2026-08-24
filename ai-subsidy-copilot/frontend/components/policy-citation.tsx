import { BookOpen, ChevronRight, FileText } from "lucide-react";
import type { PolicyCitation as Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PolicyCitation({ citation, compact = false }: { citation: Citation; compact?: boolean }) {
  if (compact) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-navy-100 bg-white px-2.5 py-1.5 text-left text-[11px] font-bold text-navy-700">
        <BookOpen className="size-3.5 shrink-0 text-teal-700" aria-hidden="true" />
        <span className="truncate">{citation.document}</span>
        <ChevronRight className="size-3 shrink-0 text-slate-400" />
        <span className="truncate text-slate-600">{citation.section}</span>
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50/70 p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-teal-700 shadow-sm"><FileText className="size-4" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-teal-700">Policy source</p>
          <p className="mt-1 text-sm font-bold text-navy-900">{citation.document}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-600">{citation.section}</p>
          {citation.excerpt ? <p className="mt-2 border-l-2 border-teal-300 pl-2.5 text-xs leading-5 text-slate-600">{citation.excerpt}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function PolicyCitationList({ citations, compact = false, className }: { citations: Citation[]; compact?: boolean; className?: string }) {
  if (!citations.length) return null;
  return (
    <div className={cn(compact ? "flex flex-wrap gap-2" : "grid gap-2", className)} aria-label="Policy sources">
      {citations.map((citation, index) => <PolicyCitation key={`${citation.document}-${citation.section}-${index}`} citation={citation} compact={compact} />)}
    </div>
  );
}
