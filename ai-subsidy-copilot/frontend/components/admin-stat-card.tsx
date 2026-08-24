import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminStatCard({ label, value, icon: Icon, detail, tone = "navy" }: { label: string; value: string | number; icon: LucideIcon; detail?: string; tone?: "navy" | "teal" | "amber" | "violet" }) {
  const tones = {
    navy: "bg-navy-50 text-navy-700",
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-extrabold tracking-tight text-navy-900">{value}</p>{detail ? <p className="mt-1 text-[11px] text-slate-500">{detail}</p> : null}</div><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tones[tone])}><Icon className="size-5" /></span></div>
    </div>
  );
}
