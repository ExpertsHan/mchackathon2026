import { AlertTriangle, CheckCircle2, CircleDot, Clock3, FilePenLine, LoaderCircle, WalletCards, XCircle } from "lucide-react";
import type { ApplicationStatus, RiskLevel } from "@/lib/types";
import { cn, humanize } from "@/lib/utils";

const statusStyle: Record<ApplicationStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-700",
  SUBMITTED: "border-sky-200 bg-sky-50 text-sky-800",
  VERIFYING: "border-blue-200 bg-blue-50 text-blue-800",
  MANUAL_REVIEW: "border-amber-200 bg-amber-50 text-amber-900",
  REQUESTED_INFORMATION: "border-orange-200 bg-orange-50 text-orange-900",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-red-200 bg-red-50 text-red-800",
  PAYMENT_SCHEDULED: "border-violet-200 bg-violet-50 text-violet-800",
  PAID: "border-teal-200 bg-teal-50 text-teal-800",
};

const statusIcon = {
  DRAFT: FilePenLine,
  SUBMITTED: CircleDot,
  VERIFYING: LoaderCircle,
  MANUAL_REVIEW: AlertTriangle,
  REQUESTED_INFORMATION: Clock3,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  PAYMENT_SCHEDULED: WalletCards,
  PAID: CheckCircle2,
} satisfies Record<ApplicationStatus, typeof CircleDot>;

export function StatusBadge({ status, className, showIcon = true }: { status: ApplicationStatus; className?: string; showIcon?: boolean }) {
  const Icon = statusIcon[status] ?? CircleDot;
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold", statusStyle[status] ?? statusStyle.DRAFT, className)}>
      {showIcon ? <Icon className={cn("size-3.5", status === "VERIFYING" && "animate-spin")} aria-hidden="true" /> : null}
      {humanize(status)}
    </span>
  );
}

const riskStyle: Record<RiskLevel, string> = {
  LOW: "border-emerald-200 bg-emerald-50 text-emerald-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-900",
  HIGH: "border-red-200 bg-red-50 text-red-800",
};

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold", riskStyle[risk], className)}>
      <span className={cn("size-1.5 rounded-full", risk === "LOW" ? "bg-emerald-600" : risk === "MEDIUM" ? "bg-amber-600" : "bg-red-600")} aria-hidden="true" />
      {risk} risk
    </span>
  );
}
