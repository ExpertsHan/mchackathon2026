"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Ban, Check, ClipboardList, FileCheck2, GraduationCap, Pencil, Plus, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, LoadingState, SectionHeading } from "@/components/ui";
import { ProgressIndicator, CompactProgress } from "@/components/progress-indicator";
import { ChatWindow } from "@/components/chat-window";
import { ChatInput, QuickReplyButtons } from "@/components/chat-input";
import { ApplicantForm } from "@/components/applicant-form";
import { DocumentUploader } from "@/components/document-uploader";
import { CitizenReviewSummary } from "@/components/source-review";
import { api } from "@/lib/api";
import { CANCELLABLE_STATUSES, OPEN_STATUSES, missingApplicantFields, submissionIssueFromError, type SubmissionIssueTarget, type SubmissionIssue } from "@/lib/intake";
import type { AgentStreamEvent, Application, ChatMessageData, SafetyProgress, SourceReview } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";
import { useSession } from "@/contexts/session-context";

const initialQuickReplies = ["Is ChatGPT eligible?", "Which documents do I need?", "How is the subsidy calculated?"];
const PENDING_LINE_CODE = "ai-subsidy-pending-line-code";

function newMessage(role: "assistant" | "user", content: string, extras: Partial<ChatMessageData> = {}): ChatMessageData {
  return { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content, ...extras };
}

function StepCard({ number, title, done, children, action }: { number: number; title: string; done: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg text-sm font-extrabold ${done ? "bg-emerald-600 text-white" : "bg-teal-50 text-teal-700"}`}>{done ? <Check className="size-5" strokeWidth={3} /> : number}</span>
          <div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-teal-700">Step {number}</p><h2 className="mt-0.5 text-lg font-bold text-navy-900">{title}</h2></div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function ApplyPage() {
  const router = useRouter();
  const { user, activeApplicationId, hydrated, setActiveApplicationId } = useSession();
  const started = useRef(false);
  const safetyReminderRecorded = useRef(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [review, setReview] = useState<SourceReview | null>(null);
  const [safetyProgress, setSafetyProgress] = useState<SafetyProgress | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [quickReplies, setQuickReplies] = useState(initialQuickReplies);
  const [creating, setCreating] = useState(true);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantAwaiting, setAssistantAwaiting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submissionIssue, setSubmissionIssue] = useState<SubmissionIssue | null>(null);
  const [lineNotice, setLineNotice] = useState<string | null>(null);

  const hydrateApplication = useCallback((data: Application) => {
    setApplication(data);
    setReview(data.source_review ?? null);
    setSafetyProgress(data.safety_progress ?? null);
  }, []);

  const refresh = useCallback(async (publicId: string) => { hydrateApplication(await api.getApplication(publicId)); }, [hydrateApplication]);

  const initialize = useCallback(async () => {
    if (!user) return;
    setCreating(true); setError(null);
    try {
      let data: Application | null = null;
      if (activeApplicationId) {
        try { data = await api.getApplication(activeApplicationId); } catch { data = null; }
      }
      if (!data || !OPEN_STATUSES.includes(data.status)) {
        // One application at a time: reuse the open one if the server already has it.
        const existing = (await api.getUserApplications(user.id)).find((item) => OPEN_STATUSES.includes(item.status));
        if (existing) data = await api.getApplication(existing.public_id);
        else if (!data) data = await api.createApplication(user.id);
      }
      setActiveApplicationId(data.public_id);
      hydrateApplication(data);
      if (!data.safety_progress) setSafetyProgress(await api.getSafetyProgress(user.id));
      const greeting = `Hi ${user.name.split(" ")[0]}. I can help you apply for the Hsinchu AI youth subsidy.\n\nFill in your details, upload the required documents, and I can answer policy questions along the way.`;
      try {
        const history = await api.getAgentHistory(data.public_id);
        setMessages(history.messages.length
          ? history.messages.map((item, index) => newMessage(item.role, item.content, { id: `history-${index}-${data.public_id}` }))
          : [newMessage("assistant", greeting)]);
      } catch { setMessages([newMessage("assistant", greeting)]); }
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setCreating(false); }
  }, [user, activeApplicationId, setActiveApplicationId, hydrateApplication]);

  useEffect(() => {
    if (!hydrated) return;
    // A LINE deep link carries a one-time code. Keep it across the login redirect.
    const code = new URLSearchParams(window.location.search).get("line_code");
    if (code) { try { window.sessionStorage.setItem(PENDING_LINE_CODE, code); } catch { /* storage blocked: link again from LINE */ } }
    if (!user) { router.replace("/login"); return; }
    if (!started.current) { started.current = true; void initialize(); }
  }, [hydrated, user, router, initialize]);

  useEffect(() => {
    if (!user) return;
    let code: string | null = null;
    try { code = window.sessionStorage.getItem(PENDING_LINE_CODE); } catch { return; }
    if (!code) return;
    try { window.sessionStorage.removeItem(PENDING_LINE_CODE); } catch { /* ignore */ }
    api.bindLine(code).then((result) => setLineNotice(result.message)).catch((err) => setLineNotice(getErrorMessage(err)));
  }, [user]);

  useEffect(() => {
    if (!user || !application || safetyReminderRecorded.current) return;
    safetyReminderRecorded.current = true;
    void api.recordSafetyEngagement({ user_id: user.id, application_id: application.public_id, event: "CHAT_REMINDER_VIEWED" }).catch(() => undefined);
  }, [user, application]);

  const applicantMissing = useMemo(() => missingApplicantFields(review?.applicant_data), [review]);
  const detailsDone = Boolean(review?.evaluation.documents_required) && applicantMissing.length === 0;
  const documentsDone = Boolean(review) && review!.missing_documents.length === 0 && review!.required_documents.length > 0;
  const checked = Boolean(review?.evaluation.result) && detailsDone && documentsDone;
  const editable = application ? ["DRAFT", "REQUESTED_INFORMATION"].includes(application.status) : false;
  const submitted = application ? !editable : false;
  const needsMoreInformation = application?.status === "REQUESTED_INFORMATION";

  const completeSteps = useMemo(() => {
    const steps = [1];
    if (detailsDone) steps.push(2);
    if (documentsDone) steps.push(3);
    if (checked) steps.push(4);
    if (submitted) steps.push(5);
    return steps;
  }, [detailsDone, documentsDone, checked, submitted]);
  const currentStep = !detailsDone ? 2 : !documentsDone ? 3 : !checked ? 4 : 5;

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

  async function onReview(next: SourceReview) {
    setSubmissionIssue(null);
    setReview(next);
    if (application) await refresh(application.public_id).catch(() => undefined);
  }

  async function recheck() {
    if (!application) return;
    setActionLoading("recheck"); setError(null); setSubmissionIssue(null);
    try { setReview(await api.analyzeSources(application.public_id)); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setActionLoading(null); }
  }

  async function submitApplication() {
    if (!application) return;
    setActionLoading("submit"); setError(null); setSubmissionIssue(null);
    try {
      const result = await api.submitApplication(application.public_id);
      hydrateApplication(result);
      router.push(`/application/${result.public_id}?submitted=1`);
    } catch (err) {
      setSubmissionIssue(submissionIssueFromError(
        err,
        applicantMissing,
        review?.missing_documents.map((item) => item.label) ?? [],
      ));
    }
    finally { setActionLoading(null); }
  }

  function goToSubmissionIssue(target: SubmissionIssueTarget) {
    if (target === "details") setEditingDetails(true);
    window.requestAnimationFrame(() => {
      document.getElementById(`application-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function cancelApplication() {
    if (!application || !window.confirm("確定要取消這筆申請嗎？取消後可重新開始新的申請。")) return;
    setActionLoading("cancel"); setError(null); setSubmissionIssue(null);
    try {
      await api.cancelApplication(application.public_id);
      setActiveApplicationId(null);
      started.current = false;
      await initialize();
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setActionLoading(null); }
  }

  if (!hydrated || creating) return <LoadingState label="Preparing your secure demo application…" className="min-h-[65vh]" />;
  if (!user) return null;

  return (
    <PageContainer>
      <SectionHeading eyebrow="Citizen application" title={`Welcome, ${user.name.split(" ")[0]}`} description="Follow the steps below or ask the assistant a policy question at any time." action={application ? <span className="rounded-lg border border-line bg-white px-3 py-2 font-mono text-xs font-bold text-navy-700">{application.public_id}</span> : undefined} />
      <div className="mt-6"><ProgressIndicator currentStep={currentStep} completedSteps={completeSteps} /></div>
      {error ? <Alert className="mt-5" tone="error" title="操作未完成">{error}</Alert> : null}
      {submissionIssue ? (
        <Alert className="mt-5" tone="error" title="申請尚未送出">
          <p>{submissionIssue.summary}</p>
          {submissionIssue.missing.length ? (
            <div className="mt-2">
              <p className="font-semibold">缺少或需要修正：</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {submissionIssue.missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          <p className="mt-2 font-medium">{submissionIssue.action}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => goToSubmissionIssue(submissionIssue.target)}>
            前往需要處理的位置
          </Button>
        </Alert>
      ) : null}
      {lineNotice ? <Alert className="mt-5" tone="info" title="LINE">{lineNotice}</Alert> : null}
      {needsMoreInformation ? (
        <Alert className="mt-5" tone="warning" title="需要補件">
          <p>{application?.requested_information ?? "請補充或更正下列資料後重新送出。"}</p>
          <p className="mt-2 text-xs">補件後系統會重新辨識並比對；先前的審核紀錄保持不變。</p>
        </Alert>
      ) : null}
      {submitted && application ? (
        <Alert className="mt-5" tone="info" title={`This application is ${application.status.toLowerCase().replaceAll("_", " ")}.`}>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href={`/application/${application.public_id}`}>View application <ArrowRight className="size-4" /></Link></Button>
            {!OPEN_STATUSES.includes(application.status) ? <Button size="sm" variant="outline" onClick={() => { setActiveApplicationId(null); started.current = false; void initialize(); }}><Plus className="size-4" /> Start a new application</Button> : null}
          </div>
        </Alert>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
        <div className="space-y-5">
          {!application ? <Card><LoadingState label="Creating application…" /></Card> : (
            <>
              <div id="application-details"><StepCard number={2} title="申請人資料" done={detailsDone} action={detailsDone && editable && !editingDetails ? <Button size="sm" variant="outline" onClick={() => setEditingDetails(true)}><Pencil className="size-4" /> 修改</Button> : undefined}>
                {detailsDone && !editingDetails ? (
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-slate-500">軟體</dt><dd className="font-semibold text-navy-900">{review?.applicant_data.applied_tool_name}（{review?.applicant_data.software_company}）</dd></div>
                    <div><dt className="text-xs text-slate-500">購買日期／繳費制度</dt><dd className="font-semibold text-navy-900">{review?.applicant_data.purchase_date} · {review?.applicant_data.payment_type === "annual" ? "年費制" : "月費制"}</dd></div>
                    <div><dt className="text-xs text-slate-500">換算新臺幣</dt><dd className="font-semibold text-navy-900">NT${review?.applicant_data.declared_amount?.toLocaleString()}</dd></div>
                    <div><dt className="text-xs text-slate-500">申請身分</dt><dd className="font-semibold text-navy-900">{{ normal: "一般青年", special: "特定對象", language: "文化語言保存者" }[review?.applicant_data.applicant_type ?? "normal"]}</dd></div>
                  </dl>
                ) : (
                  <ApplicantForm key={editingDetails ? "edit" : "new"} publicId={application.public_id} initial={review?.applicant_data} disabled={!editable} onSaved={async (next) => { setEditingDetails(false); await onReview(next); }} />
                )}
              </StepCard></div>

              <div id="application-documents"><StepCard number={3} title="上傳文件" done={documentsDone}>
                {detailsDone && review ? (
                  <>
                    <p className="mb-4 text-xs leading-5 text-slate-600">上傳後系統會自動辨識並與您填寫的資料交叉比對。文件僅供本案審核使用。</p>
                    <DocumentUploader publicId={application.public_id} review={review} disabled={!editable} onUpdated={onReview} />
                  </>
                ) : <p className="text-sm text-slate-500">請先儲存申請人資料，系統會依申請身分與付款方式列出需要的文件。</p>}
              </StepCard></div>

              <div id="application-review"><StepCard number={4} title="規則檢查結果" done={checked} action={detailsDone && editable ? <Button size="sm" variant="outline" loading={actionLoading === "recheck"} onClick={recheck}><RefreshCw className="size-4" /> 重新檢查</Button> : undefined}>
                <CitizenReviewSummary review={review} />
              </StepCard></div>

              {editable ? (
                <div id="application-submit"><StepCard number={5} title="送出申請" done={false}>
                  <div className="flex items-start gap-3 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" /><p>送出後所有案件都會交由承辦人員複核；AI 與規則引擎不會自動核准，也無法授權撥款。若文件不齊全，系統會通知您補件。</p></div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="lg" loading={actionLoading === "submit"} disabled={!detailsDone || !documentsDone} onClick={submitApplication}><FileCheck2 className="size-5" /> {needsMoreInformation ? "補件完成，重新送出" : "確認送出申請"}</Button>
                    {CANCELLABLE_STATUSES.includes(application.status) ? <Button size="lg" variant="outline" loading={actionLoading === "cancel"} onClick={cancelApplication}><Ban className="size-5" /> 取消這筆申請</Button> : null}
                  </div>
                  {!detailsDone || !documentsDone ? <p className="mt-3 text-xs text-slate-500">請先完成{!detailsDone ? "申請人資料" : "文件上傳"}才能送出。</p> : null}
                </StepCard></div>
              ) : null}
            </>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24" aria-label="Assistant and progress">
          <Card className="p-4 shadow-none">
            <div className="mb-4 flex items-center gap-3 border-b border-line pb-3"><span className="grid size-9 place-items-center rounded-lg bg-navy-50 text-navy-700"><UserRound className="size-4" /></span><div><p className="text-sm font-bold text-navy-900">{user.name}</p><p className="text-[11px] text-slate-500">{user.government_id_masked}</p></div><span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check className="size-3.5" /> Verified</span></div>
            <CompactProgress labels={[
              { label: "申請人資料", complete: detailsDone },
              { label: "文件上傳", complete: documentsDone },
              { label: "規則檢查", complete: checked },
              { label: "已送出", complete: submitted },
            ]} />
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-start gap-3"><GraduationCap className="mt-0.5 size-4 shrink-0 text-violet-700" /><div className="min-w-0"><p className="text-xs font-bold text-navy-900">Optional AI safety learning</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{safetyProgress?.completed_count ?? 0}/{safetyProgress?.required_count ?? 4} reviewed · never affects your application.</p><Link href="/safety" className="mt-1 inline-flex text-[11px] font-bold text-violet-700 hover:underline">Open lessons</Link></div></div>
              <div className="mt-3 flex items-start gap-3"><ClipboardList className="mt-0.5 size-4 shrink-0 text-teal-700" /><p className="text-[11px] leading-5 text-slate-500">在 LINE 輸入「申請」取得連結，可綁定 LINE 接收補件與撥款通知。</p></div>
            </div>
          </Card>
          <ChatWindow messages={messages} loading={assistantLoading && assistantAwaiting}>
            <QuickReplyButtons options={quickReplies} onSelect={(value) => void sendChat(value)} disabled={assistantLoading} />
            <ChatInput onSend={sendChat} disabled={assistantLoading} />
            <p className="mt-2 text-center text-[10px] text-slate-500">AI answers may be wrong. Verify important policy claims using the displayed sources.</p>
          </ChatWindow>
        </aside>
      </div>
    </PageContainer>
  );
}
