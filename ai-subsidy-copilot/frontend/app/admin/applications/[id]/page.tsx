"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, BookOpen, Bot, Calendar, FileCheck2, FileText, Fingerprint, Flag, MapPin, Phone, RefreshCw, Scale, ShieldAlert, UserRound, WalletCards } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { AuditTimeline } from "@/components/audit-timeline";
import { EligibilityChecklist } from "@/components/eligibility-checklist";
import { KeyValueGrid } from "@/components/application-summary";
import { PaymentPanel } from "@/components/payment-panel";
import { PolicyCitationList } from "@/components/policy-citation";
import { ReviewerActions } from "@/components/reviewer-actions";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { SourceReviewPanel } from "@/components/source-review";
import { api } from "@/lib/api";
import type { Application, EligibilityResult } from "@/lib/types";
import { formatCurrency, formatDate, getErrorMessage } from "@/lib/utils";

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
  const data = application.source_review?.evaluation.applicant_data as Record<string, string | number | boolean | null> | undefined;
  const typeLabel = { normal: "一般青年", special: "特定對象", language: "文化語言保存者" }[String(data?.applicant_type ?? "normal") as "normal" | "special" | "language"];
  const riskReasons = eligibility?.risk_reasons ?? application.risk_reasons ?? [];
  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="mb-5 -ml-3"><Link href="/admin"><ArrowLeft className="size-4" /> All applications</Link></Button>
      <SectionHeading eyebrow="Reviewer application detail" title={application.public_id} description="All evidence and explanations below come from persisted records and the RULE-001~020 engine. The AI never approves." action={<div className="flex flex-wrap gap-2">{application.flagged_for_check ? <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-900"><Flag className="size-3.5" /> 需進一步查核</span> : null}<RiskBadge risk={application.risk_level ?? "LOW"} /><StatusBadge status={application.status} /></div>} />
      <div className="mt-6 rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Available reviewer actions</p><p className="mt-1 text-sm text-slate-600">Only state-valid actions are shown. Every action requires server validation and is audited.</p></div><ReviewerActions application={application} onUpdated={load} /></div></div>

      {application.status === "MANUAL_REVIEW" ? <Alert className="mt-5" tone="warning" title="Human review required">{riskReasons.length ? riskReasons.join(" · ") : "規則引擎未發現問題；AI 不會自動核准，請承辦人員複核後決定。"}</Alert> : null}
      {application.requested_information ? <Alert className="mt-5" tone="warning" title="Information requested from citizen">{application.requested_information}</Alert> : null}

      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700"><UserRound className="size-5" /></span><div><h2 className="text-lg font-bold text-navy-900">Applicant</h2><p className="text-xs text-slate-500">Fictional demo identity</p></div></div>
            <KeyValueGrid items={[
              { label: "Name", value: applicant?.name ?? "—", icon: UserRound },
              { label: "身分證字號（遮罩）", value: <span className="font-mono">{applicant?.government_id_masked ?? "—"}</span>, icon: Fingerprint },
              { label: "Age", value: applicant?.age ?? "—", icon: Calendar },
              { label: "Identity verification", value: applicant?.identity_verified ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><BadgeCheck className="size-4" /> Verified</span> : "Not verified", icon: BadgeCheck },
            ]} />
          </Card>

          <Card className="p-5 sm:p-6" data-testid="applicant-data">
            <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700"><FileText className="size-5" /></span><div><h2 className="text-lg font-bold text-navy-900">申請人填寫資料</h2><p className="text-xs text-slate-500">申請人自填，與下方 OCR 擷取交叉比對</p></div></div>
            {data ? <KeyValueGrid items={[
              { label: "申請身分", value: `${typeLabel}${data.applicant_subtype ? `（${data.applicant_subtype}）` : ""}`, icon: BadgeCheck },
              { label: "聯絡電話", value: String(data.phone ?? "—"), icon: Phone },
              { label: "出生日期", value: formatDate(String(data.birth_date ?? "")), icon: Calendar },
              { label: "戶籍地址", value: String(data.household_address ?? "—"), icon: MapPin },
              { label: "通訊地址", value: String(data.mailing_address ?? "—"), icon: MapPin },
              { label: "軟體／公司", value: `${data.applied_tool_name ?? "—"}／${data.software_company ?? "—"}`, icon: FileText },
              { label: "繳費制度", value: data.payment_type === "annual" ? "年費制" : "月費制", icon: Calendar },
              { label: "購買日期", value: formatDate(String(data.purchase_date ?? "")), icon: Calendar },
              { label: "原始費用", value: `${data.original_currency ?? ""} ${data.original_amount ?? "—"}`.trim(), icon: WalletCards },
              { label: "申請換算新臺幣", value: formatCurrency(Number(data.declared_amount)), icon: WalletCards },
              { label: "本人信用卡", value: data.is_own_credit_card ? "是" : "否（父母、配偶或法定代理人代付）", icon: BadgeCheck },
            ]} /> : <p className="rounded-xl border border-dashed border-line p-5 text-sm text-slate-500">申請人尚未填寫申請資料。</p>}
          </Card>

          {eligibility ? <EligibilityChecklist result={eligibility} title="Eligibility checks" /> : <Alert tone="warning">Eligibility has not been evaluated yet.</Alert>}
          <SourceReviewPanel publicId={publicId} review={application.source_review} />

          <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700"><BookOpen className="size-5" /></span><div><h2 className="text-lg font-bold text-navy-900">AI / RAG explanation</h2><p className="text-xs text-slate-500">Retrieved policy evidence, not decision authority</p></div></div>
            {application.policy_citations?.length ? <><p className="mb-4 text-sm leading-6 text-slate-700">The application was compared with the current policy corpus. The sources below were retrieved for the application record.</p><PolicyCitationList citations={application.policy_citations} /></> : <p className="rounded-xl border border-dashed border-line p-5 text-sm text-slate-500">No policy citation is recorded yet. Run verification to retrieve applicable policy evidence.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-sky-50 p-3"><Bot className="size-4 text-sky-700" /><p className="mt-2 text-xs font-bold text-sky-950">AI assistance</p><p className="mt-1 text-[10px] leading-4 text-sky-800">Retrieved policy and extracted evidence.</p></div><div className="rounded-xl bg-teal-50 p-3"><Scale className="size-4 text-teal-700" /><p className="mt-2 text-xs font-bold text-teal-950">Rule engine</p><p className="mt-1 text-[10px] leading-4 text-teal-800">{eligibility ? `${eligibility.checks.filter((check) => check.passed).length} / ${eligibility.checks.length} checks passed.` : "Awaiting evaluation."}</p></div><div className="rounded-xl bg-violet-50 p-3"><BadgeCheck className="size-4 text-violet-700" /><p className="mt-2 text-xs font-bold text-violet-950">Decision</p><p className="mt-1 text-[10px] leading-4 text-violet-800">Recorded by policy workflow or accountable reviewer.</p></div></div>
          </Card>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-bold text-navy-900">Risk assessment</h2><RiskBadge risk={application.risk_level ?? "LOW"} /></div>
            {riskReasons.length ? <ul className="mt-4 space-y-2">{riskReasons.map((reason) => <li className="flex items-start gap-2 text-xs leading-5 text-slate-700" key={reason}><ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />{reason}</li>)}</ul> : <p className="mt-3 text-xs leading-5 text-slate-500">No risk flags were recorded.</p>}
          </Card>
          <PaymentPanel application={application} />
          <Card className="p-5"><h2 className="text-sm font-bold text-navy-900">Amount & safety</h2><div className="mt-4"><KeyValueGrid items={[
            { label: "試算補助（未核定）", value: formatCurrency(application.requested_amount_twd), icon: WalletCards },
            { label: "核定補助", value: formatCurrency(application.approved_amount_twd), icon: BadgeCheck },
            { label: "Optional safety learning", value: `${application.safety_progress?.completed_count ?? 0} / ${application.safety_progress?.required_count ?? 4} Reviewed`, icon: ShieldAlert },
          ]} /></div></Card>
          <Card className="p-5"><div className="mb-5 flex items-center gap-2"><FileCheck2 className="size-4 text-teal-700" /><h2 className="text-sm font-bold text-navy-900">Audit trail</h2></div><AuditTimeline logs={application.audit_logs ?? []} /></Card>
        </aside>
      </div>
    </PageContainer>
  );
}
