"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleDollarSign, ClipboardList, RefreshCw, Search, ShieldAlert, WalletCards } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { AdminStatCard } from "@/components/admin-stat-card";
import { ApplicationsTable } from "@/components/applications-table";
import { Alert, Button, Card, LoadingState, SectionHeading, inputClassName } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdminApplicationRow, AdminStats } from "@/lib/types";
import { formatCurrency, getErrorMessage } from "@/lib/utils";

const emptyStats: AdminStats = { total_applications: 0, submitted: 0, verifying: 0, manual_review: 0, approved: 0, rejected: 0, paid: 0, total_approved_subsidy: 0, total_paid_amount: 0 };

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats>(emptyStats);
  const [applications, setApplications] = useState<AdminApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [risk, setRisk] = useState("");
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
      const data = await api.getAdminApplications({ status, product, risk, search: debouncedSearch });
      setApplications(data.items); setTotal(data.total);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [status, product, risk, debouncedSearch]);

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

  const manualQueue = stats.manual_review + (stats.requested_information ?? 0);
  return (
    <PageContainer>
      <SectionHeading eyebrow="Demo reviewer console" title="AI Subsidy Administration" description="Inspect structured evidence, deterministic checks, risk flags, decisions, payments, and append-only audit history." action={<Button variant="outline" size="sm" onClick={resetDemo} loading={resetting}><RefreshCw className="size-4" /> Reset demo data</Button>} />
      <Alert className="mt-6" tone="info" title="Authority separation">AI assistance retrieves policy and extracts receipt data. The rule engine evaluates policy. Reviewers handle exceptions. Only the mock treasury service changes payment state.</Alert>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard label="Applications" value={stats.total_applications} icon={ClipboardList} detail={`${stats.submitted} submitted · ${stats.verifying} verifying`} />
        <AdminStatCard label="Manual review" value={manualQueue} icon={ShieldAlert} detail="Requires a human decision" tone="amber" />
        <AdminStatCard label="Approved" value={stats.approved} icon={BadgeCheck} detail={`${stats.rejected} rejected`} tone="teal" />
        <AdminStatCard label="Paid" value={stats.paid} icon={WalletCards} detail={`${stats.payment_scheduled ?? 0} scheduled`} tone="violet" />
        <AdminStatCard label="Approved subsidy" value={formatCurrency(stats.total_approved_subsidy)} icon={CircleDollarSign} detail={`${formatCurrency(stats.total_paid_amount)} paid`} tone="teal" />
      </div>

      <Card className="mt-7 overflow-hidden">
        <div className="border-b border-line p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div><h2 className="text-lg font-bold text-navy-900">Applications</h2><p className="mt-1 text-xs text-slate-500">{total} result{total === 1 ? "" : "s"} from database</p></div>
            <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-[minmax(210px,1.3fr)_repeat(3,minmax(135px,1fr))]">
              <label className="relative"><span className="sr-only">Search applications</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClassName} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID or applicant name" /></label>
              <label><span className="sr-only">Filter by status</span><select className={inputClassName} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["DRAFT", "SUBMITTED", "VERIFYING", "MANUAL_REVIEW", "REQUESTED_INFORMATION", "APPROVED", "REJECTED", "PAYMENT_SCHEDULED", "PAID"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
              <label><span className="sr-only">Filter by product</span><select className={inputClassName} value={product} onChange={(event) => setProduct(event.target.value)}><option value="">All AI tools</option><option>ChatGPT Plus</option><option>Claude Pro</option><option>Notion AI</option><option>Other</option></select></label>
              <label><span className="sr-only">Filter by risk</span><select className={inputClassName} value={risk} onChange={(event) => setRisk(event.target.value)}><option value="">All risk levels</option><option value="LOW">LOW risk</option><option value="MEDIUM">MEDIUM risk</option><option value="HIGH">HIGH risk</option></select></label>
            </div>
          </div>
        </div>
        {error ? <div className="p-4"><Alert tone="error" title="Reviewer data could not be loaded"><p>{error}</p><Button size="sm" variant="outline" className="mt-3" onClick={() => { void loadStats(); void loadApplications(); }}><RefreshCw className="size-4" /> Try again</Button></Alert></div> : null}
        {loading ? <LoadingState label="Loading applications…" /> : <ApplicationsTable applications={applications} />}
      </Card>
    </PageContainer>
  );
}
