"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { SafetyModule, SafetyProgressCard, SafetyQuiz } from "@/components/safety-module";
import { api } from "@/lib/api";
import type { QuizResult, SafetyModuleData, SafetyProgress } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";
import { useSession } from "@/contexts/session-context";

export default function SafetyPage() {
  const { user, activeApplicationId, hydrated } = useSession();
  const [modules, setModules] = useState<SafetyModuleData[]>([]);
  const [progress, setProgress] = useState<SafetyProgress | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const moduleData = await api.getSafetyModules();
      let progressData: SafetyProgress | null = null;
      if (user) progressData = await api.getSafetyProgress(user.id);
      const merged = moduleData
        .sort((a, b) => a.order_index - b.order_index)
        .map((module) => {
          const item = progressData?.modules.find((entry) => String(entry.module_id) === String(module.id));
          return { ...module, completed: item?.completed ?? false, score: item?.score, attempts: item?.attempts };
        });
      setModules(merged); setProgress(progressData);
      setActiveId((current) => current ?? merged.find((module) => !module.completed)?.id ?? merged[0]?.id ?? null);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!hydrated || !user) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, user, load]);

  const activeModule = useMemo(() => modules.find((module) => module.id === activeId) ?? modules[0], [modules, activeId]);
  const completed = progress?.completed_count ?? modules.filter((module) => module.completed).length;
  const total = progress?.required_count ?? modules.filter((module) => module.required).length;

  async function answer(choiceId: string): Promise<QuizResult> {
    if (!user || !activeModule) throw new Error("Choose a demo applicant before recording training progress.");
    const result = await api.answerSafetyModule(activeModule.id, user.id, choiceId);
    if (result.correct) {
      const latestProgress = await api.getSafetyProgress(user.id);
      setProgress(latestProgress);
      setModules((current) => current.map((module) => module.id === activeModule.id ? { ...module, completed: true, score: result.score, attempts: result.attempts ?? module.attempts } : module));
    }
    return result;
  }

  function nextModule() {
    const activeIndex = modules.findIndex((module) => module.id === activeId);
    const next = modules.slice(activeIndex + 1).find((module) => !module.completed) ?? modules.find((module) => !module.completed);
    if (next) setActiveId(next.id);
  }

  if (!hydrated) return <LoadingState label="Loading AI safety training…" className="min-h-[65vh]" />;
  if (!user) return (
    <PageContainer className="max-w-3xl py-16">
      <SectionHeading eyebrow="Required learning" title="AI Safety Training" description="Training progress is tied to a fictional demo applicant." />
      <Card className="mt-7 p-6 sm:p-8"><Alert tone="info" title="Choose a demo applicant first">The safety module list and quiz progress are protected citizen data in this demo session.</Alert><Button asChild size="lg" className="mt-5"><Link href="/login">Choose an applicant <ArrowRight className="size-5" /></Link></Button></Card>
    </PageContainer>
  );
  if (loading) return <LoadingState label="Loading AI safety training…" className="min-h-[65vh]" />;

  return (
    <PageContainer>
      <SectionHeading eyebrow="Required learning" title="AI Safety Training" description="Four practical, two-minute lessons are embedded in the application—not hidden on a separate training site." action={activeApplicationId ? <Button asChild variant="outline" size="sm"><Link href="/apply"><ArrowLeft className="size-4" /> Back to application</Link></Button> : undefined} />
      {error ? <Alert tone="error" className="mt-6" title="Training could not be loaded"><p>{error}</p><Button size="sm" variant="outline" className="mt-3" onClick={() => { setLoading(true); setError(null); void load(); }}><RefreshCw className="size-4" /> Try again</Button></Alert> : null}
      {modules.length ? (
        <div className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-24">
            <SafetyProgressCard completed={completed} total={total || 4} />
            <div className="space-y-2.5" aria-label="Safety modules">
              {modules.map((module, index) => <SafetyModule key={module.id} module={module} number={index + 1} active={module.id === activeId} onOpen={() => setActiveId(module.id)} />)}
            </div>
            <Card className="p-4 shadow-none"><div className="flex items-start gap-3 text-xs leading-5 text-slate-600"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-teal-700" /><p>Quiz answers are stored for this fake demo user only. Wrong answers can be retried.</p></div></Card>
          </aside>

          <div className="space-y-4">
            {activeModule ? <SafetyQuiz key={activeModule.id} module={activeModule} onAnswer={answer} /> : null}
            {activeModule?.completed && !progress?.complete ? <div className="flex justify-end"><Button onClick={nextModule}>Next incomplete module <ArrowRight className="size-4" /></Button></div> : null}
            {progress?.complete ? (
              <Card className="overflow-hidden border-emerald-200">
                <div className="flex flex-col gap-5 bg-emerald-50 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 className="size-6" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-emerald-700">Training complete</p><h2 className="mt-1 text-xl font-bold text-emerald-950">AI Safety Training: {completed} / {total} Complete</h2><p className="mt-1 text-sm text-emerald-900">This requirement will be included in the final server-side eligibility check.</p></div></div>
                  <Button asChild size="lg"><Link href="/apply">Review and submit <ArrowRight className="size-5" /></Link></Button>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      ) : !error ? (
        <Card className="mt-7 p-10 text-center"><GraduationCap className="mx-auto size-8 text-slate-400" /><h2 className="mt-3 text-lg font-bold text-navy-900">No training modules available</h2><p className="mt-2 text-sm text-slate-500">Seed the demo database to load the four required modules.</p></Card>
      ) : null}

      <div className="mt-8 grid gap-4 rounded-2xl bg-navy-900 p-6 text-white sm:grid-cols-3">
        <div className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-teal-300" /><div><p className="text-sm font-bold">Protect private data</p><p className="mt-1 text-xs leading-5 text-slate-300">Know what should never be pasted into AI.</p></div></div>
        <div className="flex gap-3"><RefreshCw className="size-5 shrink-0 text-teal-300" /><div><p className="text-sm font-bold">Verify important claims</p><p className="mt-1 text-xs leading-5 text-slate-300">Confidence is not the same as correctness.</p></div></div>
        <div className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-teal-300" /><div><p className="text-sm font-bold">Keep humans accountable</p><p className="mt-1 text-xs leading-5 text-slate-300">AI assists; established procedures decide.</p></div></div>
      </div>
    </PageContainer>
  );
}
