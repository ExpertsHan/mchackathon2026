import { AlertCircle, Check, Circle, Clock3, X } from "lucide-react";
import type { Application, ApplicationStatus, TimelineEvent } from "@/lib/types";
import { cn, formatDateTime, humanize, statusDescription } from "@/lib/utils";

export function ApplicationTimeline({ application, events }: { application: Application; events?: TimelineEvent[] }) {
  const timeline = events?.length ? events : [{
    key: application.status,
    title: humanize(application.status),
    description: statusDescription(application.status),
    occurred_at: application.updated_at ?? application.created_at,
    actor_type: "SYSTEM",
  }];
  const exceptional = ["MANUAL_REVIEW", "REQUESTED_INFORMATION"].includes(application.status);
  const rejected = application.status === "REJECTED";
  const terminalComplete = application.status === "PAID";
  return (
    <ol className="relative" aria-label="Application timeline">
      {timeline.map((event, index) => {
        const last = index === timeline.length - 1;
        const warning = last && exceptional;
        const failed = last && rejected;
        const current = last && !terminalComplete && !warning && !failed;
        const complete = !last || terminalComplete;
        return (
          <li className="relative grid grid-cols-[2rem_1fr] gap-3 pb-7 last:pb-0" key={event.key ?? `${event.title}-${index}`}>
            {!last ? <span className="absolute left-[15px] top-7 h-[calc(100%-1rem)] w-0.5 bg-emerald-300" aria-hidden="true" /> : null}
            <span className={cn("relative z-10 grid size-8 place-items-center rounded-full border-2 bg-white", complete ? "border-emerald-600 bg-emerald-600 text-white" : failed ? "border-red-600 bg-red-50 text-red-700" : warning ? "border-amber-500 bg-amber-50 text-amber-700" : current ? "border-navy-700 text-navy-700 ring-4 ring-navy-50" : "border-slate-300 text-slate-300")}>
              {complete ? <Check className="size-4" strokeWidth={3} /> : failed ? <X className="size-4" strokeWidth={3} /> : warning ? <AlertCircle className="size-4" /> : current ? <Clock3 className="size-4" /> : <Circle className="size-2 fill-current" />}
            </span>
            <div className="pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-navy-900">{event.title}</p>{event.occurred_at ? <time className="text-[10px] font-semibold text-slate-500">{formatDateTime(event.occurred_at)}</time> : null}</div>
              {event.description ? <p className="mt-1 text-xs leading-5 text-slate-600">{event.description}</p> : null}
              {event.actor_type ? <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{humanize(event.actor_type)}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CurrentStatusCallout({ status, reason }: { status: ApplicationStatus; reason?: string | null }) {
  const warning = ["MANUAL_REVIEW", "REQUESTED_INFORMATION", "REJECTED"].includes(status);
  const rejected = status === "REJECTED";
  return (
    <div className={cn("rounded-xl border p-4", rejected ? "border-red-200 bg-red-50" : warning ? "border-amber-200 bg-amber-50" : "border-navy-100 bg-navy-50")}>
      <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-slate-600">Current status</p>
      <p className="mt-1 text-lg font-extrabold text-navy-900">{humanize(status)}</p>
      {reason ? <p className="mt-2 text-sm leading-6 text-slate-700">{reason}</p> : null}
    </div>
  );
}
