"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Clock3, FileSearch, Search, ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, EmptyState, LoadingState, SectionHeading, inputClassName } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { Application } from "@/lib/types";
import { formatDateTime, getErrorMessage } from "@/lib/utils";
import { useSession } from "@/contexts/session-context";

export default function TrackPage() {
  const router = useRouter();
  const { user, activeApplicationId, hydrated } = useSession();
  const [query, setQuery] = useState(activeApplicationId ?? "");
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    if (!user) return;
    try { setApplications(await api.getUserApplications(user.id)); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace("/login?next=/track");
      return;
    }
    const timer = window.setTimeout(() => void loadRecent(), 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, user, router, loadRecent]);

  if (!hydrated || !user) {
    return <LoadingState label="Taking you to demo login…" className="min-h-[65vh]" />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = query.trim().toUpperCase();
    if (!/^AI-\d{4}-\d{6}$/.test(id)) { setError("Enter an application ID in the format AI-2026-000001."); return; }
    router.push(`/application/${encodeURIComponent(id)}`);
  }

  return (
    <PageContainer className="max-w-5xl">
      <SectionHeading eyebrow="Citizen tracking" title="Track an application" description="Enter a public application ID to see verification, review, approval, and mock payment progress." />
      <Card className="mt-7 overflow-hidden">
        <div className="grid gap-6 bg-navy-900 p-6 text-white sm:grid-cols-[1fr_auto] sm:items-end sm:p-8">
          <div><p className="text-xs font-bold uppercase tracking-[.14em] text-teal-200">Application lookup</p><h2 className="mt-2 text-2xl font-bold">Where is my subsidy?</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Public IDs are human-friendly and do not expose internal database identifiers.</p></div><FileSearch className="hidden size-14 text-white/15 sm:block" />
        </div>
        <form onSubmit={submit} className="p-5 sm:p-6">
          <label htmlFor="application-id" className="text-sm font-bold text-navy-900">Application ID</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="application-id" className={`${inputClassName} font-mono uppercase`} value={query} onChange={(event) => { setQuery(event.target.value); setError(null); }} placeholder="AI-2026-000001" autoComplete="off" /><Button type="submit" size="lg"><Search className="size-4" /> Track</Button></div>
          {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
        </form>
      </Card>

      <div className="mt-10 flex items-center justify-between gap-4"><h2 className="text-lg font-bold text-navy-900">{user ? `${user.name.split(" ")[0]}’s recent applications` : "Recent applications"}</h2>{user ? <Button asChild size="sm" variant="outline"><Link href="/apply">Start application</Link></Button> : null}</div>
      {loading ? <LoadingState label="Loading recent applications…" /> : applications.length ? (
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white shadow-card">
          {applications.map((application) => <Link key={application.public_id} href={`/application/${application.public_id}`} className="group flex items-center gap-4 p-4 hover:bg-navy-50 sm:p-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700"><Clock3 className="size-5" /></span><div className="min-w-0 flex-1"><p className="truncate font-mono text-sm font-extrabold text-navy-900">{application.public_id}</p><p className="mt-1 text-xs text-slate-500">Created {formatDateTime(application.created_at)}</p></div><StatusBadge status={application.status} /><ArrowRight className="hidden size-4 text-slate-400 group-hover:text-navy-700 sm:block" /></Link>)}
        </div>
      ) : (
        <Card className="mt-4"><EmptyState icon={<FileSearch className="size-6" />} title={user ? "No applications yet" : "Choose a demo applicant"} description={user ? "Start a guided application to see it here." : "Sign in with a fictional profile to see recent applications."} action={<Button asChild><Link href={user ? "/apply" : "/login"}>{user ? "Start application" : "Demo login"} <ArrowRight className="size-4" /></Link></Button>} /></Card>
      )}
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-line bg-white p-4 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" /> Tracking reflects persisted backend state. The assistant cannot claim approval or payment unless those states exist.</div>
    </PageContainer>
  );
}
