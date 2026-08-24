"use client";

import * as Progress from "@radix-ui/react-progress";
import { useState } from "react";
import { ArrowRight, Check, CheckCircle2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import type { QuizResult, SafetyModuleData } from "@/lib/types";
import { Alert, Button, Card } from "@/components/ui";
import { cn, getErrorMessage } from "@/lib/utils";

const moduleIcons: Record<string, typeof LockKeyhole> = {
  privacy: LockKeyhole,
  hallucinations: ShieldCheck,
  prompt_injection: ShieldCheck,
  "prompt-injection": ShieldCheck,
  human_responsibility: ShieldCheck,
  "human-responsibility": ShieldCheck,
};

export function SafetyModule({ module, number, active, onOpen }: { module: SafetyModuleData; number: number; active: boolean; onOpen: () => void }) {
  const Icon = moduleIcons[module.slug] ?? ShieldCheck;
  return (
    <button type="button" onClick={onOpen} aria-current={active ? "step" : undefined} className={cn("w-full rounded-xl border p-4 text-left transition", active ? "border-navy-600 bg-navy-50 shadow-sm" : module.completed ? "border-emerald-200 bg-emerald-50/60" : "border-line bg-white hover:border-navy-200 hover:bg-slate-50")}>
      <div className="flex items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", module.completed ? "bg-emerald-600 text-white" : active ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-500")}>
          {module.completed ? <Check className="size-5" strokeWidth={3} /> : <Icon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-slate-500">Module {number}</p><p className="mt-0.5 truncate text-sm font-bold text-navy-900">{module.title}</p></div>
        <ArrowRight className="size-4 shrink-0 text-slate-400" />
      </div>
    </button>
  );
}

export function SafetyQuiz({ module, onAnswer }: { module: SafetyModuleData; onAnswer: (choiceId: string) => Promise<QuizResult> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<QuizResult | null>(module.completed ? { correct: true, completed: true, score: module.score ?? 100, explanation: "This module is complete." } : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      setResult(await onAnswer(selected));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setSelected(null);
    setResult(null);
    setError(null);
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-navy-900 px-5 py-5 text-white sm:px-6">
        <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-teal-200">AI Safety Training</p>
        <h2 className="mt-2 text-2xl font-bold">{module.title}</h2>
      </div>
      <div className="p-5 sm:p-6">
        <div className="prose-safety space-y-3 text-sm leading-7 text-slate-700">
          {module.content.split("\n").filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph.replace(/^[-*]\s*/, "")}</p>)}
        </div>

        <div className="mt-7 rounded-xl border border-line bg-slate-50 p-4 sm:p-5">
          <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-teal-700">Knowledge check</p>
          <h3 className="mt-2 text-base font-bold leading-6 text-navy-900">{module.question}</h3>
          <div className="mt-4 space-y-2" role="radiogroup" aria-label={module.question}>
            {module.choices.map((choice) => {
              const checked = selected === choice.id;
              return (
                <button key={choice.id} role="radio" aria-checked={checked} disabled={result?.correct || submitting} onClick={() => setSelected(choice.id)} type="button" className={cn("flex w-full items-start gap-3 rounded-xl border bg-white p-3.5 text-left text-sm leading-6", checked ? "border-navy-600 ring-2 ring-navy-100" : "border-slate-200 hover:border-slate-400", result?.correct && "opacity-70")}>
                  <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-navy-700" : "border-slate-300")}>{checked ? <span className="size-2.5 rounded-full bg-navy-700" /> : null}</span>
                  <span className="font-medium text-navy-900">{choice.label}</span>
                </button>
              );
            })}
          </div>

          {error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}
          {result ? <Alert className="mt-4" tone={result.correct ? "success" : "warning"} title={result.correct ? "Correct — module complete" : "Not quite — try again"}>{result.explanation}</Alert> : null}

          <div className="mt-4 flex justify-end">
            {result && !result.correct ? <Button variant="outline" onClick={retry}><RefreshCw className="size-4" /> Try again</Button> : result?.correct ? <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="size-5" /> Completed</span> : <Button onClick={submit} loading={submitting} disabled={!selected}>Check answer</Button>}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SafetyProgressCard({ completed, total }: { completed: number; total: number }) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return (
    <Card className="p-5 shadow-none">
      <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Your progress</p><p className="mt-1 text-xl font-extrabold text-navy-900">{completed} / {total} Complete</p></div><span className="grid size-12 place-items-center rounded-full bg-teal-50 text-sm font-extrabold text-teal-800">{percent}%</span></div>
      <Progress.Root className="relative mt-4 h-2 overflow-hidden rounded-full bg-slate-200" value={percent} aria-label={`${completed} of ${total} AI safety modules complete`}>
        <Progress.Indicator className="h-full rounded-full bg-teal-700 transition-transform duration-500" style={{ transform: `translateX(-${100 - percent}%)` }} />
      </Progress.Root>
      <p className="mt-3 text-xs leading-5 text-slate-500">All required modules must be completed before final application submission.</p>
    </Card>
  );
}
