"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Calendar, CheckCircle2, FileText, RefreshCw, ShieldAlert, UserRound, WalletCards } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { ApplicationTimeline, CurrentStatusCallout } from "@/components/application-timeline";
import { EligibilityChecklist } from "@/components/eligibility-checklist";
import { PaymentPanel } from "@/components/payment-panel";
import { PolicyCitationList } from "@/components/policy-citation";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { KeyValueGrid } from "@/components/application-summary";
import { api } from "@/lib/api";
import type { Application, EligibilityResult, TimelineEvent } from "@/lib/types";
import { formatCurrency, formatDate, formatDateTime, formatReceiptAmount, getErrorMessage, statusDescription } from "@/lib/utils";

function eligibilityOf(application: Application): EligibilityResult | null {
  const value = application.eligibility_result;
  return value && typeof value === "object" && "checks" in value ? value : null;
}

export default function ApplicationStatusPage() {
  const params = useParams<{ id: string }>();
  const publicId = decodeURIComponent(params.id);
  const [application, setApplication] = useState<Application | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, timeline] = await Promise.all([api.getApplication(publicId), api.getTimeline(publicId)]);
      setApplication(detail); setEvents(timeline);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [publicId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (loading) return <LoadingState label="Loading application status…" className="min-h-[65vh]" />;
  if (error || !application) return <PageContainer className="max-w-2xl py-16"><Card className="p-6"><Alert tone="error" title="Application could not be found">{error ?? "No application was returned."}</Alert><div className="mt-5 flex gap-2"><Button onClick={() => { setLoading(true); setError(null); void load(); }}><RefreshCw className="size-4" /> Try again</Button><Button asChild variant="outline"><Link href="/track">Track another ID</Link></Button></div></Card></PageContainer>;

  const eligibility = eligibilityOf(application);
  const reason = application.requested_information ?? application.review_reason;
  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="mb-5 -ml-3"><Link href="/track"><ArrowLeft className="size-4" /> Track another application</Link></Button>
      <SectionHeading eyebrow="Application tracking" title={application.public_id} description="Status is derived from persisted application and audit records—not a frontend simulation." action={<div className="flex flex-wrap items-center gap-2"><RiskBadge risk={application.risk_level ?? "LOW"} /><StatusBadge status={application.status} /></div>} />

      {["MANUAL_REVIEW", "REQUESTED_INFORMATION"].includes(application.status) ? <Alert className="mt-6" tone="warning" title={application.status === "REQUESTED_INFORMATION" ? "More information is required" : "This application requires human review"}>{reason ?? (application.risk_reasons?.length ? application.risk_reasons.join(" · ") : "A reviewer is checking the evidence and risk flags.")}</Alert> : null}
      {application.status === "REJECTED" ? <Alert className="mt-6" tone="error" title="Application rejected">{application.review_reason ?? "The application did not meet the demo program requirements."}</Alert> : null}
      {application.status === "PAID" ? <Alert className="mt-6" tone="success" title="Mock subsidy paid">The demo treasury recorded a completed payment of {formatCurrency(application.payment?.amount_twd ?? application.approved_amount_twd)}.</Alert> : null}

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Current outcome</p><h2 className="mt-2 text-2xl font-extrabold text-navy-900">{statusDescription(application.status)}</h2></div><div className="rounded-xl bg-teal-50 px-4 py-3 text-right"><p className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700">Approved amount</p><p className="mt-1 text-xl font-extrabold text-navy-900">{formatCurrency(application.approved_amount_twd)}</p></div></div>
            <div className="mt-6"><ApplicationTimeline application={application} events={events} /></div>
          </Card>

          {eligibility ? <EligibilityChecklist result={eligibility} title="Deterministic eligibility checks" /> : null}

        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          <CurrentStatusCallout status={application.status} reason={reason} />
          <Card className="p-5">
            <h2 className="text-sm font-bold text-navy-900">Application details</h2>
            <div className="mt-4"><KeyValueGrid items={[
              { label: "Applicant", value: application.applicant?.name ?? "—", icon: UserRound },
              { label: "Submitted", value: formatDateTime(application.submitted_at), icon: Calendar },
              { label: "AI tool", value: application.subscription?.product ?? "—", icon: FileText },
              { label: "Receipt amount", value: formatReceiptAmount(application.subscription?.amount, application.subscription?.currency), icon: WalletCards },
              { label: "Purchase date", value: formatDate(application.subscription?.purchase_date), icon: Calendar },
              { label: "Safety training", value: application.safety_progress?.complete ? "4 / 4 Complete" : `${application.safety_progress?.completed_count ?? 0} / ${application.safety_progress?.required_count ?? 4} Complete`, icon: CheckCircle2 },
            ]} /></div>
          </Card>
          <PaymentPanel application={application} />
          {application.policy_citations?.length ? <Card className="p-5"><div className="mb-4 flex items-center gap-2"><BookOpen className="size-4 text-teal-700" /><h2 className="text-sm font-bold text-navy-900">Policy sources</h2></div><PolicyCitationList citations={application.policy_citations} /></Card> : null}
          <div className="flex items-start gap-3 rounded-xl border border-line bg-white p-4 text-xs leading-5 text-slate-500"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-navy-700" /> This page shows concise rule explanations, not hidden model reasoning. Payment status is read from the mock treasury record.</div>
        </aside>
      </div>
    </PageContainer>
  );
}
