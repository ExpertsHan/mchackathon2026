"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarDays, Check, ChevronRight, CircleUserRound, RefreshCw, ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { api } from "@/lib/api";
import type { DemoUser } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";
import { useSession } from "@/contexts/session-context";
import { validatedPostLoginPath } from "@/lib/demo-auth";

function scenarioFor(user: DemoUser) {
  if (user.age < 18) return { label: "Age rule demo", tone: "bg-amber-100 text-amber-900", description: "Shows a failed age requirement" };
  if (user.name.toLowerCase().includes("jamie")) return { label: "Review demo", tone: "bg-violet-100 text-violet-900", description: "Shows duplicate-receipt review" };
  return { label: "Happy path", tone: "bg-emerald-100 text-emerald-900", description: "Eligible, low-risk application" };
}

export default function LoginPage() {
  const router = useRouter();
  const { setDemoSession } = useSession();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.getDemoUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function login(user: DemoUser) {
    setSelected(user.id);
    setError(null);
    try {
      const session = await api.loginDemoUser(user.id);
      setDemoSession(session.user, session.demo_token);
      const requestedDestination = new URLSearchParams(window.location.search).get("next");
      router.push(validatedPostLoginPath(requestedDestination));
    } catch (err) {
      setError(getErrorMessage(err));
      setSelected(null);
    }
  }

  return (
    <PageContainer className="max-w-5xl">
      <SectionHeading eyebrow="Demo government login" title="Choose a fictional applicant" description="No real identity provider is connected. These profiles contain fake values created only for this demonstration." />

      <Alert className="mt-6" tone="info" title="Identity simulation">
        Selecting a profile simulates successful government sign-in. The applicant’s masked demo ID is the only identifier displayed.
      </Alert>

      {error ? (
        <Alert className="mt-5" tone="error" title="Could not load demo applicants">
          <p>{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => { setLoading(true); setError(null); void loadUsers(); }}><RefreshCw className="size-4" /> Try again</Button>
        </Alert>
      ) : null}

      {loading ? <LoadingState label="Loading demo applicants…" className="mt-8" /> : (
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {users.map((user) => {
            const scenario = scenarioFor(user);
            const initials = user.name.split(" ").map((part) => part[0]).join("");
            return (
              <Card key={user.id} className="relative flex flex-col overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-float">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-12 place-items-center rounded-xl bg-navy-700 text-sm font-extrabold text-white">{initials}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${scenario.tone}`}>{scenario.label}</span>
                </div>
                <h2 className="mt-5 text-xl font-bold text-navy-900">{user.name}</h2>
                <p className="mt-1 text-xs text-slate-500">{scenario.description}</p>
                <dl className="mt-5 space-y-3 border-y border-line py-4 text-sm">
                  <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-slate-500"><CircleUserRound className="size-4" /> Demo ID</dt><dd className="font-mono text-xs font-semibold text-navy-900">{user.government_id_masked}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-slate-500"><CalendarDays className="size-4" /> Age</dt><dd className="font-semibold text-navy-900">{user.age}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-slate-500"><BadgeCheck className="size-4" /> Identity</dt><dd className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Check className="size-4" /> Verified</dd></div>
                </dl>
                <Button className="mt-5 w-full" loading={selected === user.id} disabled={selected !== null} onClick={() => login(user)}>
                  Continue as {user.name.split(" ")[0]} <ChevronRight className="size-4" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-line bg-white p-4 text-xs leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
        This MVP does not connect to a national ID system, bank, tax service, or AI subscription account. All applicant identities are fictional.
      </div>
    </PageContainer>
  );
}
