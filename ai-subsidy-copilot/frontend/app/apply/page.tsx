"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, FileCheck2, GraduationCap, Package, Plus, ReceiptText, ShieldCheck, UserRound } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { ProgressIndicator, CompactProgress } from "@/components/progress-indicator";
import { ChatWindow } from "@/components/chat-window";
import { ChatInput, QuickReplyButtons } from "@/components/chat-input";
import { ReceiptUploader } from "@/components/receipt-uploader";
import { ReceiptSummary } from "@/components/receipt-summary";
import { EligibilityChecklist } from "@/components/eligibility-checklist";
import { ApplicationSummary } from "@/components/application-summary";
import { PolicyCitationList } from "@/components/policy-citation";
import { PRODUCTS } from "@/lib/constants";
import { api } from "@/lib/api";
import type { AgentStreamEvent, Application, ChatMessageData, EligibilityResult, ProductOption, SafetyProgress, Subscription } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";
import { useSession } from "@/contexts/session-context";

const initialQuickReplies = ["Is ChatGPT Plus eligible?", "What evidence do I need?", "How is the subsidy calculated?"];

function newMessage(role: "assistant" | "user", content: string, extras: Partial<ChatMessageData> = {}): ChatMessageData {
  return { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content, ...extras };
}

function isEligibilityResult(value: Application["eligibility_result"]): value is EligibilityResult {
  return Boolean(value && typeof value === "object" && "checks" in value);
}

function hasUploadedReceipt(subscription?: Subscription | null) {
  return Boolean(subscription?.receipt_uploaded || subscription?.receipt_hash);
}

export default function ApplyPage() {
  const router = useRouter();
  const { user, activeApplicationId, hydrated, setActiveApplicationId } = useSession();
  const started = useRef(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [safetyProgress, setSafetyProgress] = useState<SafetyProgress | null>(null);
  const [receiptConfirmed, setReceiptConfirmed] = useState(false);
  const [evidenceUpdated, setEvidenceUpdated] = useState(false);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [quickReplies, setQuickReplies] = useState(initialQuickReplies);
  const [creating, setCreating] = useState(true);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantAwaiting, setAssistantAwaiting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hydrateApplication = useCallback((data: Application) => {
    setApplication(data);
    setSubscription(data.subscription ?? null);
    setEligibility(isEligibilityResult(data.eligibility_result) ? data.eligibility_result : null);
    setSafetyProgress(data.safety_progress ?? null);
    setReceiptConfirmed(hasUploadedReceipt(data.subscription) || isEligibilityResult(data.eligibility_result));
    setEvidenceUpdated(data.status !== "REQUESTED_INFORMATION");
  }, []);

  const initialize = useCallback(async () => {
    if (!user) return;
    setCreating(true); setError(null);
    try {
      let data: Application;
      if (activeApplicationId) {
        try { data = await api.getApplication(activeApplicationId); }
        catch { data = await api.createApplication(user.id); setActiveApplicationId(data.public_id); }
      } else {
        data = await api.createApplication(user.id);
        setActiveApplicationId(data.public_id);
      }
      hydrateApplication(data);
      if (!data.safety_progress) setSafetyProgress(await api.getSafetyProgress(user.id));
      try {
        const history = await api.getAgentHistory(data.public_id);
        setMessages(history.messages.length
          ? history.messages.map((item, index) => newMessage(item.role, item.content, { id: `history-${index}-${data.public_id}` }))
          : [newMessage("assistant", `Hi ${user.name.split(" ")[0]}. I can help you apply for the fictional AI Tool Subsidy.\n\nWhich AI service did you subscribe to?`)]);
      } catch {
        setMessages([newMessage("assistant", `Hi ${user.name.split(" ")[0]}. I can help you apply for the fictional AI Tool Subsidy.\n\nWhich AI service did you subscribe to?`)]);
      }
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setCreating(false); }
  }, [user, activeApplicationId, setActiveApplicationId, hydrateApplication]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) { router.replace("/login"); return; }
    if (!started.current) { started.current = true; void initialize(); }
  }, [hydrated, user, router, initialize]);

  const completeSteps = useMemo(() => {
    const steps: number[] = [];
    if (user?.identity_verified) steps.push(1);
    if (subscription?.product) steps.push(2);
    if (hasUploadedReceipt(subscription)) steps.push(3);
    if (eligibility) steps.push(4);
    if (safetyProgress?.complete) steps.push(5);
    if (application && !["DRAFT", "REQUESTED_INFORMATION"].includes(application.status)) steps.push(6);
    return steps;
  }, [user, subscription, eligibility, safetyProgress, application]);

  const needsMoreInformation = application?.status === "REQUESTED_INFORMATION";
  const currentStep = needsMoreInformation && !evidenceUpdated ? 3 : !subscription?.product ? 2 : !hasUploadedReceipt(subscription) ? 3 : !eligibility ? 4 : !safetyProgress?.complete ? 5 : 6;

  async function sendChat(message: string) {
    if (!user || assistantLoading) return;
    setMessages((current) => [...current, newMessage("user", message)]);
    setAssistantLoading(true); setAssistantAwaiting(true); setQuickReplies([]);
    const assistantId = `assistant-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let assistantStarted = false;
    let streamFailed = false;

    function updateAssistant(event: AgentStreamEvent) {
      if (event.type === "delta") {
        setAssistantAwaiting(false);
        if (!assistantStarted) {
          assistantStarted = true;
          setMessages((current) => [...current, { id: assistantId, role: "assistant", content: event.text }]);
        } else {
          setMessages((current) => current.map((item) => item.id === assistantId
            ? { ...item, content: `${item.content}${event.text}` }
            : item));
        }
      } else if (event.type === "citations") {
        setMessages((current) => current.map((item) => item.id === assistantId
          ? { ...item, citations: event.citations }
          : item));
      } else if (event.type === "suggested_actions") {
        setQuickReplies(event.suggested_actions
          .filter((item) => item.value || item.label)
          .map((item) => item.value ?? item.label)
          .slice(0, 4));
      } else if (event.type === "error") {
        streamFailed = true;
        setAssistantAwaiting(false);
        const interruption = `\n\n${event.message}`;
        if (assistantStarted) {
          setMessages((current) => current.map((item) => item.id === assistantId
            ? { ...item, content: `${item.content}${interruption}`, tone: "warning" }
            : item));
        } else {
          assistantStarted = true;
          setMessages((current) => [...current, newMessage("assistant", event.message, { id: assistantId, tone: "warning" })]);
        }
        setQuickReplies(initialQuickReplies);
      }
    }
    try {
      await api.streamChat(
        { user_id: user.id, application_id: application?.public_id, message },
        updateAssistant,
      );
    } catch (err) {
      if (!streamFailed) {
        const failure = `The AI assistant is temporarily unavailable. ${getErrorMessage(err)} You can continue with the structured steps beside this chat.`;
        if (assistantStarted) {
          setMessages((current) => current.map((item) => item.id === assistantId
            ? { ...item, content: `${item.content}\n\n${failure}`, tone: "warning" }
            : item));
        } else {
          setMessages((current) => [...current, newMessage("assistant", failure, { tone: "warning" })]);
        }
      }
      setQuickReplies(initialQuickReplies);
    } finally { setAssistantLoading(false); setAssistantAwaiting(false); }
  }

  async function chooseProduct(product: ProductOption) {
    if (!application || actionLoading) return;
    setActionLoading("product"); setError(null);
    try {
      const result = await api.setSubscription(application.public_id, product.provider, product.product);
      const nextSubscription = ("public_id" in result ? result.subscription : result) as Subscription;
      setSubscription(nextSubscription);
      setReceiptConfirmed(false); setEligibility(null);
      setMessages((current) => [...current, newMessage("user", product.product)]);
      setAssistantLoading(true); setAssistantAwaiting(true);
      try {
        const response = await api.chat({ user_id: user!.id, application_id: application.public_id, message: `Is ${product.product} eligible under the current program?` });
        setMessages((current) => [...current, newMessage("assistant", response.message, { citations: response.citations })]);
        setQuickReplies(["What should my receipt show?", "How much could I receive?"]);
      } catch (err) {
        setMessages((current) => [...current, newMessage("assistant", `I saved your selection, but policy assistance is temporarily unavailable. ${getErrorMessage(err)} You can continue by uploading your receipt.`, { tone: "warning" })]);
      } finally { setAssistantLoading(false); setAssistantAwaiting(false); }
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setActionLoading(null); }
  }

  async function uploadReceipt(file: File) {
    if (!application) return;
    const result = await api.uploadReceipt(application.public_id, file);
    const nextSubscription = ("public_id" in result ? result.subscription : result) as Subscription;
    setSubscription(nextSubscription); setReceiptConfirmed(false); setEligibility(null); setEvidenceUpdated(true);
    setMessages((current) => [...current, newMessage("assistant", "I extracted the receipt fields as untrusted evidence. Please check them before I ask the deterministic rule engine to evaluate your application.", { tone: "success" })]);
  }

  async function confirmReceipt() {
    if (!application) return;
    setReceiptConfirmed(true); setEvidenceUpdated(true); setActionLoading("eligibility"); setError(null);
    try {
      const result = await api.checkEligibility(application.public_id);
      setEligibility(result);
      const content = result.requires_manual_review
        ? "The rule engine found an issue that needs human review. You can still complete safety training and submit the application."
        : result.eligible || result.provisional
          ? "The deterministic rule engine says you are provisionally eligible. AI Safety Training must be complete before final submission."
          : "The rule engine found one or more requirements that are not met. Review each check below for a clear explanation.";
      setMessages((current) => [...current, newMessage("assistant", content, { tone: result.requires_manual_review ? "warning" : result.eligible || result.provisional ? "success" : "warning" })]);
    } catch (err) { setError(getErrorMessage(err)); setReceiptConfirmed(false); }
    finally { setActionLoading(null); }
  }

  async function submitApplication() {
    if (!application) return;
    setActionLoading("submit"); setError(null);
    try {
      const finalEligibility = await api.checkEligibility(application.public_id);
      setEligibility(finalEligibility);
      const submitted = await api.submitApplication(application.public_id);
      hydrateApplication(submitted);
      router.push(`/application/${submitted.public_id}`);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setActionLoading(null); }
  }

  async function startAnother() {
    if (!user) return;
    setCreating(true); setError(null);
    try {
      const next = await api.createApplication(user.id);
      setActiveApplicationId(next.public_id); setApplication(next); setSubscription(null); setEligibility(null); setReceiptConfirmed(false); setEvidenceUpdated(true);
      setMessages([newMessage("assistant", `New draft created. Which AI service did you subscribe to, ${user.name.split(" ")[0]}?`)]);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setCreating(false); }
  }

  if (!hydrated || creating) return <LoadingState label="Preparing your secure demo application…" className="min-h-[65vh]" />;
  if (!user) return null;

  const finalized = application && !["DRAFT", "REQUESTED_INFORMATION"].includes(application.status);
  return (
    <PageContainer>
      <SectionHeading eyebrow="Citizen application" title={`Welcome, ${user.name.split(" ")[0]}`} description="Follow the structured steps or ask the assistant a policy question at any time." action={application ? <span className="rounded-lg border border-line bg-white px-3 py-2 font-mono text-xs font-bold text-navy-700">{application.public_id}</span> : undefined} />
      <div className="mt-6"><ProgressIndicator currentStep={currentStep} completedSteps={completeSteps} /></div>
      {error ? <Alert className="mt-5" tone="error" title="Action could not be completed">{error}</Alert> : null}
      {needsMoreInformation ? (
        <Alert className="mt-5" tone="warning" title="A reviewer requested more information">
          <p>{application?.requested_information ?? "Please review or replace your subscription evidence, run the eligibility check again, and resubmit."}</p>
          <p className="mt-2 text-xs">This application is reopened for evidence updates. Its prior audit history remains unchanged.</p>
        </Alert>
      ) : null}
      {finalized ? (
        <Alert className="mt-5" tone="info" title={`This application is already ${application.status.toLowerCase().replaceAll("_", " ")}.`}>
          <div className="mt-2 flex flex-wrap gap-2"><Button asChild size="sm"><Link href={`/application/${application.public_id}`}>View application <ArrowRight className="size-4" /></Link></Button><Button size="sm" variant="outline" onClick={startAnother}><Plus className="size-4" /> Start another draft</Button></div>
        </Alert>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(350px,.75fr)]">
        <ChatWindow messages={messages} loading={assistantLoading && assistantAwaiting}>
          <QuickReplyButtons options={quickReplies} onSelect={(value) => void sendChat(value)} disabled={assistantLoading} />
          <ChatInput onSend={sendChat} disabled={assistantLoading} />
          <p className="mt-2 text-center text-[10px] text-slate-500">AI answers may be wrong. Verify important policy claims using the displayed sources.</p>
        </ChatWindow>

        <aside className="space-y-5 lg:sticky lg:top-24" aria-label="Structured application steps">
          <Card className="p-4 shadow-none">
            <div className="mb-4 flex items-center gap-3 border-b border-line pb-3"><span className="grid size-9 place-items-center rounded-lg bg-navy-50 text-navy-700"><UserRound className="size-4" /></span><div><p className="text-sm font-bold text-navy-900">{user.name}</p><p className="text-[11px] text-slate-500">{user.government_id_masked} · Age {user.age}</p></div><span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check className="size-3.5" /> Verified</span></div>
            <CompactProgress labels={[
              { label: "Identity", complete: Boolean(user.identity_verified) },
              { label: "Subscription", complete: Boolean(subscription?.product) },
              { label: "Receipt", complete: hasUploadedReceipt(subscription) },
              { label: "Eligibility", complete: Boolean(eligibility) },
              { label: "AI Safety", complete: Boolean(safetyProgress?.complete), detail: `${safetyProgress?.completed_count ?? 0}/${safetyProgress?.required_count ?? 4}` },
            ]} />
          </Card>

          {!application ? <Card><LoadingState label="Creating application…" /></Card> : finalized ? (
            <Card className="p-5"><h2 className="text-lg font-bold text-navy-900">Application submitted</h2><p className="mt-2 text-sm leading-6 text-slate-600">Continue to the tracking page for verification, review, and payment updates.</p><Button asChild className="mt-5 w-full"><Link href={`/application/${application.public_id}`}>Track application <ArrowRight className="size-4" /></Link></Button></Card>
          ) : !subscription?.product ? (
            <Card className="p-5">
              <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700"><Package className="size-5" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-teal-700">Step 2</p><h2 className="mt-1 text-lg font-bold text-navy-900">Choose your AI service</h2></div></div>
              <div className="mt-4 space-y-2.5">
                {PRODUCTS.map((product) => <button key={product.product} type="button" onClick={() => chooseProduct(product)} disabled={actionLoading !== null} className="group flex w-full items-center gap-3 rounded-xl border border-line bg-white p-3.5 text-left hover:border-navy-300 hover:bg-navy-50 disabled:opacity-50"><span className={cn("grid size-9 shrink-0 place-items-center rounded-lg text-xs font-extrabold", product.eligible ? "bg-navy-100 text-navy-800" : "bg-slate-100 text-slate-600")}>{product.product.charAt(0)}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-navy-900">{product.product}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{product.description}</span></span>{product.eligible ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-extrabold uppercase text-emerald-700">Listed</span> : null}<ChevronRight className="size-4 text-slate-400" /></button>)}
              </div>
            </Card>
          ) : !hasUploadedReceipt(subscription) ? (
            <Card className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700"><ReceiptText className="size-5" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-teal-700">Step 3</p><h2 className="mt-1 text-lg font-bold text-navy-900">Upload your receipt</h2><p className="mt-1 text-xs text-slate-500">Selected: {subscription.product}</p></div></div><button type="button" className="text-xs font-bold text-navy-700 underline-offset-2 hover:underline" onClick={() => setSubscription(null)}>Change</button></div>
              <ReceiptUploader onUpload={uploadReceipt} />
            </Card>
          ) : needsMoreInformation && subscription && hasUploadedReceipt(subscription) ? (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><ReceiptText className="size-5" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-amber-700">Reviewer follow-up</p><h2 className="mt-1 text-lg font-bold text-navy-900">Review or replace your evidence</h2><p className="mt-1 text-xs leading-5 text-slate-600">Upload a corrected receipt if needed. A replacement is re-extracted as data and cannot trigger approval or payment.</p></div></div>
                <div className="mt-4"><ReceiptSummary subscription={subscription} /></div>
                <div className="mt-5 border-t border-line pt-5"><h3 className="mb-3 text-sm font-bold text-navy-900">Replace supporting receipt</h3><ReceiptUploader onUpload={uploadReceipt} /></div>
                <Button className="mt-4 w-full" variant="outline" loading={actionLoading === "eligibility"} onClick={confirmReceipt}>{evidenceUpdated ? "Check updated evidence" : "Re-check current evidence"} <ArrowRight className="size-4" /></Button>
              </Card>
              {evidenceUpdated && eligibility ? <EligibilityChecklist result={eligibility} title="Updated eligibility check" /> : null}
              {evidenceUpdated && eligibility && safetyProgress?.complete ? <Card className="p-5"><div className="flex items-start gap-3 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" /><p>Resubmission runs the final server-side policy check. The reviewer request and your updated evidence remain in the audit trail.</p></div><Button className="mt-4 w-full" size="lg" loading={actionLoading === "submit"} onClick={submitApplication}><FileCheck2 className="size-5" /> Resubmit application</Button></Card> : null}
            </div>
          ) : !receiptConfirmed && !eligibility ? (
            <div><ReceiptSummary subscription={subscription} confirmed={receiptConfirmed} onConfirm={confirmReceipt} />{actionLoading === "eligibility" ? <LoadingState label="Running deterministic checks…" className="min-h-24" /> : null}</div>
          ) : eligibility && !safetyProgress?.complete ? (
            <div className="space-y-4"><EligibilityChecklist result={eligibility} /><Card className="p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><GraduationCap className="size-5" /></span><div><h2 className="text-base font-bold text-navy-900">AI Safety Training required</h2><p className="mt-1 text-xs leading-5 text-slate-600">Complete four short modules before final submission.</p></div></div><Button asChild className="mt-4 w-full"><Link href="/safety">Continue training · {safetyProgress?.completed_count ?? 0}/4 <ArrowRight className="size-4" /></Link></Button></Card></div>
          ) : subscription && safetyProgress?.complete ? (
            <div className="space-y-4"><ApplicationSummary compact user={user} subscription={subscription} eligibility={eligibility} safetyProgress={safetyProgress} application={application} />{application.policy_citations?.length ? <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Policy evidence</h3><PolicyCitationList citations={application.policy_citations} /></Card> : null}<Card className="p-5"><div className="flex items-start gap-3 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" /><p>Submitting runs the final rule check on the server. The AI cannot approve this application or authorize payment.</p></div><Button className="mt-4 w-full" size="lg" loading={actionLoading === "submit"} onClick={submitApplication}><FileCheck2 className="size-5" /> Submit application</Button></Card></div>
          ) : <Card><LoadingState label="Checking application progress…" /></Card>}
        </aside>
      </div>
    </PageContainer>
  );
}
