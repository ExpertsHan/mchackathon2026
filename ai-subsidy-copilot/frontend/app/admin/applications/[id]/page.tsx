"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, BookOpen, Bot, Calendar, FileCheck2, FileText, Fingerprint, Mail, RefreshCw, Scale, ShieldAlert, UserRound, WalletCards } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { AuditTimeline } from "@/components/audit-timeline";
import { EligibilityChecklist } from "@/components/eligibility-checklist";
import { KeyValueGrid } from "@/components/application-summary";
import { PaymentPanel } from "@/components/payment-panel";
import { PolicyCitationList } from "@/components/policy-citation";
import { ReceiptSummary } from "@/components/receipt-summary";
import { ReviewerActions } from "@/components/reviewer-actions";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { Application, EligibilityResult } from "@/lib/types";
import { formatCurrency, formatDate, formatReceiptAmount, getErrorMessage, truncateHash } from "@/lib/utils";

function eligibilityOf(application: Application): EligibilityResult | null {
  const value = application.eligibility_result;
  return value && typeof value === "object" && "checks" in value ? value : null;
}

export default function ReviewerApplicationPage() {
  const params = useParams<{ id: string }>();
  const publicId = decodeURIComponent(params.id);
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setApplication(await api.getAdminApplication(publicId)); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [publicId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (loading) return <LoadingState label="Loading reviewer record…" className="min-h-[65vh]" />;
  if (error || !application) return <PageContainer className="max-w-2xl py-16"><Card className="p-6"><Alert tone="error" title="Reviewer record could not be loaded">{error ?? "Application not found."}</Alert><div className="mt-5 flex gap-2"><Button onClick={() => { setLoading(true); setError(null); void load(); }}><RefreshCw className="size-4" /> Try again</Button><Button asChild variant="outline"><Link href="/admin">Back to dashboard</Link></Button></div></Card></PageContainer>;

  const eligibility = eligibilityOf(application);
  const applicant = application.applicant;
  const subscription = application.subscription;
  const riskReasons = eligibility?.risk_reasons ?? application.risk_reasons ?? [];
  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="mb-5 -ml-3"><Link href="/admin"><ArrowLeft className="size-4" /> All applications</Link></Button>
      <SectionHeading eyebrow="Reviewer application detail" title={application.public_id} description="All evidence and explanations below come from persisted records and deterministic service outputs." action={<div className="flex flex-wrap gap-2"><RiskBadge risk={application.risk_level ?? "LOW"} /><StatusBadge status={application.status} /></div>} />
      <div className="mt-6 rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Available reviewer actions</p><p className="mt-1 text-sm text-slate-600">Only state-valid actions are shown. Every action requires server validation and is audited.</p></div><ReviewerActions application={application} onUpdated={load} /></div></div>

      {application.status === "MANUAL_REVIEW" ? <Alert className="mt-5" tone="warning" title="Human review required">{riskReasons.length ? riskReasons.join(" · ") : "The automatic workflow could not safely establish a decision."}</Alert> : null}
      {application.requested_information ? <Alert className="mt-5" tone="warning" title="Information requested from citizen">{application.requested_information}</Alert> : null}

      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700"><UserRound className="size-5" /></span><div><h2 className="text-lg font-bold text-navy-900">Applicant</h2><p className="text-xs text-slate-500">Fictional demo identity</p></div></div>
            <KeyValueGrid items={[
              { label: "Name", value: applicant?.name ?? "—", icon: UserRound },
              { label: "Demo government ID", value: <span className="font-mono">{applicant?.government_id_masked ?? "—"}</span>, icon: Fingerprint },
              { label: "Age", value: applicant?.age ?? "—", icon: Calendar },
              { label: "Identity verification", value: applicant?.identity_verified ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><BadgeCheck className="size-4" /> Verified</span> : "Not verified", icon: BadgeCheck },
            ]} />
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700"><FileText className="size-5" /></span><div><h2 className="text-lg font-bold text-navy-900">Subscription & evidence</h2><p className="text-xs text-slate-500">Uploaded receipt extraction</p></div></div>
            {subscription ? <><ReceiptSummary subscription={subscription} /><div className="mt-4"><KeyValueGrid items={[
              { label: "Receipt fingerprint", value: <span title={subscription.receipt_hash ?? undefined} className="font-mono text-xs">{truncateHash(subscription.receipt_hash)}</span>, icon: Fingerprint },
              { label: "Stored filename", value: subscription.receipt_filename ?? "—", icon: FileText },
              { label: "Converted amount", value: formatCurrency(subscription.amount_twd), icon: WalletCards },
              { label: "Extraction confidence", value: subscription.extraction_confidence === null || subscription.extraction_confidence === undefined ? "—" : `${Math.round(subscription.extraction_confidence * 100)}%`, icon: FileCheck2 },
            ]} /></div>
              {subscription.suspicious_content ? <Alert className="mt-4" tone="warning" title="Suspicious document text detected">Document text was treated as untrusted data. Embedded instructions were not executed and this claim requires review.</Alert> : null}
              {subscription.extraction_warnings_json?.length ? <Alert className="mt-4" tone="warning" title="Extraction warnings">{subscription.extraction_warnings_json.join(" · ")}</Alert> : null}
            </> : <p className="rounded-xl border border-dashed border-line p-5 text-sm text-slate-500">No receipt evidence has been attached.</p>}
          </Card>

          {eligibility ? <EligibilityChecklist result={eligibility} title="Eligibility checks" /> : <Alert tone="warning">Eligibility has not been evaluated yet.</Alert>}

          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700"><BookOpen className="size-5" /></span><div><h2 className="text-lg font-bold text-navy-900">AI / RAG explanation</h2><p className="text-xs text-slate-500">Retrieved policy evidence, not decision authority</p></div></div>
            {application.policy_citations?.length ? <><p className="mb-4 text-sm leading-6 text-slate-700">{subscription?.product} was compared with the current fictional policy corpus. The sources below were retrieved for the application record.</p><PolicyCitationList citations={application.policy_citations} /></> : <p className="rounded-xl border border-dashed border-line p-5 text-sm text-slate-500">No policy citation is recorded yet. Run verification to retrieve applicable policy evidence.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-sky-50 p-3"><Bot className="size-4 text-sky-700" /><p className="mt-2 text-xs font-bold text-sky-950">AI assistance</p><p className="mt-1 text-[10px] leading-4 text-sky-800">Retrieved policy and extracted evidence.</p></div><div className="rounded-xl bg-teal-50 p-3"><Scale className="size-4 text-teal-700" /><p className="mt-2 text-xs font-bold text-teal-950">Rule engine</p><p className="mt-1 text-[10px] leading-4 text-teal-800">{eligibility ? `${eligibility.checks.filter((check) => check.passed).length} / ${eligibility.checks.length} checks passed.` : "Awaiting evaluation."}</p></div><div className="rounded-xl bg-violet-50 p-3"><BadgeCheck className="size-4 text-violet-700" /><p className="mt-2 text-xs font-bold text-violet-950">Decision</p><p className="mt-1 text-[10px] leading-4 text-violet-800">Recorded by policy workflow or accountable reviewer.</p></div></div>
          </Card>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-bold text-navy-900">Risk assessment</h2><RiskBadge risk={application.risk_level ?? "LOW"} /></div>
            {riskReasons.length ? <ul className="mt-4 space-y-2">{riskReasons.map((reason) => <li className="flex items-start gap-2 text-xs leading-5 text-slate-700" key={reason}><ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />{reason}</li>)}</ul> : <p className="mt-3 text-xs leading-5 text-slate-500">No risk flags were recorded.</p>}
          </Card>
          <PaymentPanel application={application} />
          <Card className="p-5"><h2 className="text-sm font-bold text-navy-900">Safety & amount</h2><div className="mt-4"><KeyValueGrid items={[
            { label: "Safety progress", value: application.safety_progress?.complete ? `${application.safety_progress.completed_count} / ${application.safety_progress.required_count} Complete` : `${application.safety_progress?.completed_count ?? 0} / ${application.safety_progress?.required_count ?? 4}`, icon: ShieldAlert },
            { label: "Requested subsidy", value: formatCurrency(application.requested_amount_twd), icon: WalletCards },
            { label: "Approved subsidy", value: formatCurrency(application.approved_amount_twd), icon: BadgeCheck },
            { label: "Receipt amount", value: formatReceiptAmount(subscription?.amount, subscription?.currency), icon: WalletCards },
            { label: "Purchase date", value: formatDate(subscription?.purchase_date), icon: Calendar },
            { label: "Account on receipt", value: subscription?.account_email ?? "Not shown", icon: Mail },
          ]} /></div></Card>
          <Card className="p-5"><div className="mb-5 flex items-center gap-2"><FileCheck2 className="size-4 text-teal-700" /><h2 className="text-sm font-bold text-navy-900">Audit trail</h2></div><AuditTimeline logs={application.audit_logs ?? []} /></Card>
        </aside>
      </div>
    </PageContainer>
  );
}
