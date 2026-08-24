import { Bot, CircleDot, Cpu, Landmark, Scale, UserRound, WalletCards } from "lucide-react";
import type { AuditLog } from "@/lib/types";
import { formatDateTime, humanize } from "@/lib/utils";

function iconFor(actor: string) {
  if (actor === "AI_AGENT") return Bot;
  if (actor === "RULE_ENGINE") return Scale;
  if (actor === "REVIEWER") return Landmark;
  if (actor === "PAYMENT_SERVICE") return WalletCards;
  if (actor === "CITIZEN") return UserRound;
  if (actor === "SYSTEM") return Cpu;
  return CircleDot;
}

export function AuditTimeline({ logs }: { logs: AuditLog[] }) {
  if (!logs.length) return <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-slate-500">No audit events have been recorded yet.</p>;
  const sorted = [...logs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return (
    <ol className="relative space-y-0" aria-label="Append-only application audit trail">
      {sorted.map((log, index) => {
        const Icon = iconFor(log.actor_type);
        const detail = log.details_json?.reason ?? log.details_json?.message ?? log.details_json?.outcome;
        return (
          <li className="relative grid grid-cols-[2rem_1fr] gap-3 pb-6 last:pb-0" key={log.id}>
            {index < sorted.length - 1 ? <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-line" /> : null}
            <span className="relative z-10 grid size-8 place-items-center rounded-full border border-line bg-white text-navy-700"><Icon className="size-4" /></span>
            <div className="pt-0.5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-navy-900">{humanize(log.action)}</p><time className="text-[10px] text-slate-500">{formatDateTime(log.created_at)}</time></div><p className="mt-1 text-xs text-slate-500">{humanize(log.actor_type)}{log.actor_identifier ? ` · ${log.actor_identifier}` : ""}</p>{typeof detail === "string" ? <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{detail}</p> : null}</div>
          </li>
        );
      })}
    </ol>
  );
}
