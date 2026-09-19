"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Bot, CircleDollarSign, ClipboardList, Clock3, FileScan, ListChecks, RefreshCw, Search, ShieldAlert, TriangleAlert, WalletCards, Send, Scan } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { AdminStatCard } from "@/components/admin-stat-card";
import { ApplicationsTable } from "@/components/applications-table";
import { Alert, Button, Card, LoadingState, SectionHeading, inputClassName } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdminApplicationRow, AdminStats } from "@/lib/types";
import { formatCurrency, getErrorMessage } from "@/lib/utils";

const emptyStats: AdminStats = {
  total_applications: 0, submitted: 0, verifying: 0, manual_review: 0, approved: 0, rejected: 0, paid: 0, total_approved_subsidy: 0, total_paid_amount: 0,
  documents_uploaded: 0, documents_ocr_processed: 0, ocr_fields_extracted: 0, applications_submitted: 0, rules_total_checked: 0, rules_auto_passed: 0,
  issues_found: 0, supplement_notifications_sent: 0, applications_needing_human_review: 0, estimated_minutes_saved: 0, assumption_note: "",
};
const AI_FILTERS = [["", "全部"], ["PASS", "✅ PASS"], ["REVIEW", "🔍 REVIEW"], ["NEED_SUPPLEMENT", "📋 需補件"], ["REJECT", "❌ REJECT"], ["FRAUD_RISK", "🚨 FRAUD_RISK"]] as const;
const REVIEW_FILTERS = [["all", "全部"], ["pending", "未審核"], ["reviewed", "已審核"]] as const;
// "Reviewed" means a reviewer (or the applicant, for a cancellation) has closed the decision.
const REVIEWED = ["APPROVED", "REJECTED", "PAYMENT_SCHEDULED", "PAID", "CANCELLED", "REQUESTED_INFORMATION"];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats>(emptyStats);
  const [applications, setApplications] = useState<AdminApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [risk, setRisk] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [reviewState, setReviewState] = useState<"all" | "pending" | "reviewed">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try { setStats(await api.getAdminStats()); }
    catch (err) { setError(getErrorMessage(err)); }
  }, []);

  const loadApplications = useCallback(async () => {
    try {
      const data = await api.getAdminApplications({ status, product, risk, aiResult, search: debouncedSearch });
      setApplications(data.items); setTotal(data.total);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [status, product, risk, aiResult, debouncedSearch]);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadStats(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStats]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadApplications(), 0);
    return () => window.clearTimeout(timer);
  }, [loadApplications]);

  async function resetDemo() {
    if (!window.confirm("Reset and reseed all demo applications? This cannot be undone from the UI.")) return;
    setResetting(true); setError(null);
    try { await api.resetDemo(); await Promise.all([loadStats(), loadApplications()]); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setResetting(false); }
  }

  const visible = applications.filter((row) => reviewState === "all" || (reviewState === "reviewed") === REVIEWED.includes(row.status));
  const manualQueue = stats.manual_review + (stats.requested_information ?? 0);
  return (
    <PageContainer>
      <SectionHeading eyebrow="Demo reviewer console" title="AI 補助申請 — 智慧審核後台" description="檢視文件證據、RULE-001~020 判定、風險標記、承辦人決定、撥款與僅可附加的稽核紀錄。" action={<Button variant="outline" size="sm" onClick={resetDemo} loading={resetting}><RefreshCw className="size-4" /> Reset demo data</Button>} />
      <Alert className="mt-6" tone="info" title="Authority separation">AI reads documents and explains policy. The RULE-001~020 engine advises on eligibility and the trial amount. A named reviewer decides every application. Only the mock treasury service changes payment state.</Alert>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard label="Applications" value={stats.total_applications} icon={ClipboardList} detail={`${stats.submitted} submitted · ${stats.verifying} verifying`} />
        <AdminStatCard label="Manual review" value={manualQueue} icon={ShieldAlert} detail="Requires a human decision" tone="amber" />
        <AdminStatCard label="Approved" value={stats.approved} icon={BadgeCheck} detail={`${stats.rejected} rejected`} tone="teal" />
        <AdminStatCard label="Paid" value={stats.paid} icon={WalletCards} detail={`${stats.payment_scheduled ?? 0} scheduled`} tone="violet" />
        <AdminStatCard label="Approved subsidy" value={formatCurrency(stats.total_approved_subsidy)} icon={CircleDollarSign} detail={`${formatCurrency(stats.total_paid_amount)} paid`} tone="teal" />
      </div>

      <section className="mt-7" aria-label="AI 幫市府處理了什麼">
        <h2 className="text-sm font-bold text-navy-900">AI 幫市府處理了什麼</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-dashboard">
          <AdminStatCard label="AI 自動讀取文件數" value={stats.documents_ocr_processed} icon={FileScan} detail={`共 ${stats.documents_uploaded} 份上傳`} />
          <AdminStatCard label="OCR 擷取欄位數" value={stats.ocr_fields_extracted} icon={Scan} />
          <AdminStatCard label="自動通過規則數" value={`${stats.rules_auto_passed}/${stats.rules_total_checked}`} icon={ListChecks} tone="teal" />
          <AdminStatCard label="發現異常/待確認項目" value={stats.issues_found} icon={TriangleAlert} tone="amber" />
          <AdminStatCard label="自動產生補件通知" value={stats.supplement_notifications_sent} icon={Send} tone="violet" />
          <AdminStatCard label="待人工處理案件" value={stats.applications_needing_human_review} icon={Bot} tone="amber" />
          <AdminStatCard label="已送出申請案件" value={stats.applications_submitted} icon={ClipboardList} />
          <AdminStatCard label="預估節省審核時間" value={`${Math.round((stats.estimated_minutes_saved / 60) * 10) / 10} 小時`} icon={Clock3} tone="teal" />
        </div>
        {stats.assumption_note ? <p className="mt-2 text-[11px] text-slate-500">{stats.assumption_note}</p> : null}
      </section>

      <Card className="mt-7 overflow-hidden">
        <div className="border-b border-line p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div><h2 className="text-lg font-bold text-navy-900">Applications</h2><p className="mt-1 text-xs text-slate-500">{visible.length} of {total} result{total === 1 ? "" : "s"} from database</p></div>
            <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-[minmax(210px,1.3fr)_repeat(3,minmax(135px,1fr))]">
              <label className="relative"><span className="sr-only">Search applications</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClassName} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID or applicant name" /></label>
              <label><span className="sr-only">Filter by status</span><select className={inputClassName} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["DRAFT", "SUBMITTED", "VERIFYING", "MANUAL_REVIEW", "REQUESTED_INFORMATION", "APPROVED", "REJECTED", "PAYMENT_SCHEDULED", "PAID", "CANCELLED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
              <label><span className="sr-only">Filter by software</span><input className={inputClassName} value={product} onChange={(event) => setProduct(event.target.value)} placeholder="軟體名稱（完全相符）" /></label>
              <label><span className="sr-only">Filter by risk</span><select className={inputClassName} value={risk} onChange={(event) => setRisk(event.target.value)}><option value="">All risk levels</option><option value="LOW">LOW risk</option><option value="MEDIUM">MEDIUM risk</option><option value="HIGH">HIGH risk</option></select></label>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-4 py-3 text-xs sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="AI 建議"><span className="text-slate-500">AI建議：</span>{AI_FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={aiResult === value} onClick={() => setAiResult(value)} className={`rounded-full border px-3 py-1 font-semibold ${aiResult === value ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-slate-50 text-slate-700 hover:bg-navy-50"}`}>{label}</button>)}</div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="審核狀態"><span className="text-slate-500">審核狀態：</span>{REVIEW_FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={reviewState === value} onClick={() => setReviewState(value)} className={`rounded-full border px-3 py-1 font-semibold ${reviewState === value ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-slate-50 text-slate-700 hover:bg-navy-50"}`}>{label}</button>)}</div>
        </div>
        {error ? <div className="p-4"><Alert tone="error" title="Reviewer data could not be loaded"><p>{error}</p><Button size="sm" variant="outline" className="mt-3" onClick={() => { void loadStats(); void loadApplications(); }}><RefreshCw className="size-4" /> Try again</Button></Alert></div> : null}
        {loading ? <LoadingState label="Loading applications…" /> : <ApplicationsTable applications={visible} />}
      </Card>
    </PageContainer>
  );
}
