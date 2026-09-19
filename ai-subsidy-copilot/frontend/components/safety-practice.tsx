"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, GraduationCap, SkipForward } from "lucide-react";
import { api } from "@/lib/api";
import type { PolicyCitation } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";
import { PolicyCitationList } from "@/components/policy-citation";
import { Alert, Button, Card } from "@/components/ui";

export function SafetyPractice({ userId, applicationId }: { userId: string; applicationId: string }) {
  const shownRecorded = useRef(false);
  const [selected, setSelected] = useState<"A" | "B" | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [ragAnswer, setRagAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<PolicyCitation[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);

  useEffect(() => {
    if (shownRecorded.current) return;
    shownRecorded.current = true;
    void api.recordSafetyEngagement({
      user_id: userId,
      application_id: applicationId,
      event: "PRACTICE_SHOWN",
    }).catch(() => undefined);
  }, [userId, applicationId]);

  function choose(option: "A" | "B") {
    if (selected) return;
    setSelected(option);
    void api.recordSafetyEngagement({
      user_id: userId,
      application_id: applicationId,
      event: "PRACTICE_ANSWERED",
      selected_option: option,
    }).catch(() => undefined);
  }

  function skip() {
    setSkipped(true);
    void api.recordSafetyEngagement({
      user_id: userId,
      application_id: applicationId,
      event: "PRACTICE_SKIPPED",
    }).catch(() => undefined);
  }

  async function openRagFollowUp() {
    setRagLoading(true);
    setRagError(null);
    try {
      const result = await api.searchPolicy(
        "Can I paste company meeting notes into an AI assistant? Explain privacy, confidential information, authorization, and identifiers.",
      );
      setRagAnswer(result.answer ?? "Review the cited safety guidance before sharing workplace material.");
      setCitations(result.citations ?? []);
      void api.recordSafetyEngagement({
        user_id: userId,
        application_id: applicationId,
        event: "RAG_FOLLOWUP_OPENED",
      }).catch(() => undefined);
    } catch (error) {
      setRagError(getErrorMessage(error));
    } finally {
      setRagLoading(false);
    }
  }

  if (skipped) {
    return (
      <Alert tone="info" title="Optional practice skipped">
        Your application is unaffected. You can reopen the exercise if you want to explore it.
        <Button className="mt-3" size="sm" variant="outline" onClick={() => setSkipped(false)}>Reopen practice</Button>
      </Alert>
    );
  }

  return (
    <Card className="overflow-hidden border-violet-200">
      <div className="border-b border-violet-100 bg-violet-50 px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-700 text-white"><GraduationCap className="size-5" /></span>
            <div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-violet-700">Optional · about one minute</p><h2 className="mt-1 text-lg font-bold text-navy-900">Quick privacy practice</h2></div>
          </div>
          {!selected ? <Button size="sm" variant="ghost" onClick={skip}><SkipForward className="size-4" /> Skip</Button> : null}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-600">This uses fictional data. Your answer does not affect eligibility, submission, review, or payment.</p>
      </div>

      <div className="p-5 sm:p-6">
        <p className="text-sm font-bold leading-6 text-navy-900">Ask AI to add up two subscription expenses. Which input provides what the task needs while sharing less personal data?</p>
        <div className="mt-4 grid gap-3">
          <button type="button" disabled={Boolean(selected)} onClick={() => choose("A")} className={`rounded-xl border p-4 text-left text-sm leading-6 ${selected === "A" ? "border-amber-400 bg-amber-50" : "border-line bg-white hover:border-slate-400"}`}>
            <span className="mr-2 font-extrabold">A.</span> “Name: demo user; full bank account: [fictional account number]; Tool A NT$300, Tool B NT$200.”
          </button>
          <button type="button" disabled={Boolean(selected)} onClick={() => choose("B")} className={`rounded-xl border p-4 text-left text-sm leading-6 ${selected === "B" ? "border-emerald-400 bg-emerald-50" : "border-line bg-white hover:border-slate-400"}`}>
            <span className="mr-2 font-extrabold">B.</span> “Tool A NT$300 and Tool B NT$200.”
          </button>
        </div>

        {selected ? (
          <Alert className="mt-4" tone={selected === "B" ? "success" : "warning"} title={selected === "B" ? "Correct — B shares only what is needed" : "B is the safer request"}>
            B keeps the items and amounts needed to calculate NT$500. A name and full account number do not help with this task. Share the minimum information needed and use fictional examples when possible. No retake is required.
          </Alert>
        ) : null}

        {selected ? (
          <div className="mt-5 border-t border-line pt-5">
            <Button variant="outline" onClick={openRagFollowUp} loading={ragLoading}><BookOpen className="size-4" /> What about company meeting notes?</Button>
            {ragError ? <Alert className="mt-4" tone="error">{ragError}</Alert> : null}
            {ragAnswer ? <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="flex gap-2 text-sm font-bold text-navy-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" />Policy-grounded answer</div><p className="mt-2 text-sm leading-6 text-slate-700">{ragAnswer}</p><PolicyCitationList className="mt-4" citations={citations} /></div> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
