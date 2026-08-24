import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import type { AdminApplicationRow } from "@/lib/types";
import { EmptyState } from "@/components/ui";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function ApplicationsTable({ applications }: { applications: AdminApplicationRow[] }) {
  if (!applications.length) return <EmptyState icon={<Inbox className="size-6" />} title="No applications found" description="Try changing the search term or filters." />;
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead><tr className="border-b border-line bg-slate-50 text-[10px] font-extrabold uppercase tracking-[.1em] text-slate-500"><th className="px-5 py-3.5">Application ID</th><th className="px-4 py-3.5">Applicant</th><th className="px-4 py-3.5">AI tool</th><th className="px-4 py-3.5 text-right">Requested</th><th className="px-4 py-3.5 text-right">Approved</th><th className="px-4 py-3.5">Risk</th><th className="px-4 py-3.5">Status</th><th className="px-4 py-3.5">Submitted</th><th className="w-12 px-4 py-3.5"><span className="sr-only">View</span></th></tr></thead>
          <tbody className="divide-y divide-line">
            {applications.map((application) => (
              <tr key={application.public_id} className="group hover:bg-navy-50/50">
                <td className="px-5 py-4"><Link href={`/admin/applications/${application.public_id}`} className="font-mono text-xs font-extrabold text-navy-700 underline-offset-4 hover:underline">{application.public_id}</Link></td>
                <td className="px-4 py-4"><p className="font-bold text-navy-900">{application.applicant}</p></td>
                <td className="px-4 py-4"><p className="font-semibold text-navy-900">{application.product ?? "—"}</p></td>
                <td className="px-4 py-4 text-right font-semibold text-slate-700">{formatCurrency(application.requested_amount_twd)}</td>
                <td className="px-4 py-4 text-right font-bold text-navy-900">{formatCurrency(application.approved_amount_twd)}</td>
                <td className="px-4 py-4"><RiskBadge risk={application.risk_level ?? "LOW"} /></td>
                <td className="px-4 py-4"><StatusBadge status={application.status} /></td>
                <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDateTime(application.submitted_at)}</td>
                <td className="px-4 py-4"><Link href={`/admin/applications/${application.public_id}`} className="grid size-8 place-items-center rounded-lg text-slate-400 group-hover:bg-white group-hover:text-navy-700" aria-label={`Open ${application.public_id}`}><ArrowRight className="size-4" /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-line lg:hidden">
        {applications.map((application) => (
          <Link href={`/admin/applications/${application.public_id}`} key={application.public_id} className="block p-4 hover:bg-navy-50/50">
            <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-extrabold text-navy-700">{application.public_id}</p><p className="mt-1 text-sm font-bold text-navy-900">{application.applicant}</p></div><ArrowRight className="mt-1 size-4 text-slate-400" /></div>
            <p className="mt-3 text-xs font-semibold text-slate-600">{application.product ?? "No subscription"} · {formatCurrency(application.requested_amount_twd)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2"><RiskBadge risk={application.risk_level ?? "LOW"} /><StatusBadge status={application.status} /></div>
          </Link>
        ))}
      </div>
    </>
  );
}
