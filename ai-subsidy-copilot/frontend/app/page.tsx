import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  Check,
  FileSearch,
  Landmark,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Button, Card } from "@/components/ui";

const features = [
  {
    icon: Bot,
    title: "Apply with guidance",
    description: "A conversational copilot explains the policy, gathers evidence, and shows what is still missing.",
    href: "/login",
    link: "Start an application",
  },
  {
    icon: BookOpenCheck,
    title: "Learn as you apply",
    description: "Four short, practical AI safety lessons are embedded directly into the application journey.",
    href: "/login",
    link: "Begin AI safety",
  },
  {
    icon: FileSearch,
    title: "Track every decision",
    description: "See verification, review, approval, and mock payment progress in one clear timeline.",
    href: "/track",
    link: "Track an application",
  },
];

const checks = ["Eligible AI tool", "Receipt verified", "Safety complete", "Policy rules passed"];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line bg-white">
        <div className="page-grid absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="absolute -right-28 -top-40 size-[32rem] rounded-full bg-teal-50 blur-3xl" aria-hidden="true" />
        <PageContainer className="relative grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.08fr_.92fr] lg:py-24">
          <div className="max-w-3xl animate-fade-up">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800">
              <Sparkles className="size-4" aria-hidden="true" /> Fictional AI Tool Subsidy · 2026
            </div>
            <h1 className="text-balance text-4xl font-extrabold leading-[1.08] tracking-[-0.035em] text-navy-900 sm:text-5xl lg:text-6xl">
              Apply smarter.<br /><span className="text-teal-700">Learn safer.</span><br />Track every dollar.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Get up to <strong className="font-extrabold text-navy-900">NT$600</strong> toward an eligible AI subscription, with clear policy guidance at every step.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/login">Start demo application <ArrowRight className="size-5" aria-hidden="true" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/admin"><Landmark className="size-5" aria-hidden="true" /> Government reviewer demo</Link>
              </Button>
            </div>
            <p className="mt-5 flex items-start gap-2 text-sm text-slate-500">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" /> Uses fake demo identities and mock payments only. No real government or banking systems are connected.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-lg animate-fade-up [animation-delay:120ms]">
            <div className="absolute -inset-5 rounded-[2rem] border border-navy-100 bg-navy-50/70" aria-hidden="true" />
            <Card className="relative overflow-hidden shadow-float">
              <div className="flex items-center justify-between border-b border-line bg-navy-900 px-5 py-4 text-white">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-white/10"><Bot className="size-5" /></span>
                  <div><p className="text-sm font-bold">AI Subsidy Copilot</p><p className="text-xs text-slate-300">Policy-guided application</p></div>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-100"><span className="size-2 rounded-full bg-emerald-400" /> Ready</span>
              </div>
              <div className="space-y-5 p-5 sm:p-6">
                <div className="rounded-xl rounded-tl-sm bg-navy-50 p-4 text-sm leading-6 text-navy-900">
                  Hi Alex. ChatGPT Plus is included in the current demo program. Upload your receipt when you’re ready.
                  <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-navy-100 bg-white px-2.5 py-1.5 text-xs font-bold text-navy-700">
                    <FileSearch className="size-3.5" /> Policy · Article 5
                  </div>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-xl border border-line bg-white p-4 shadow-sm">
                  <span className="row-span-2 grid size-10 place-items-center rounded-lg bg-teal-50 text-teal-700"><ReceiptText className="size-5" /></span>
                  <p className="text-sm font-bold text-navy-900">Receipt analyzed</p>
                  <p className="text-xs text-slate-500">ChatGPT Plus · USD 20 · Aug 18, 2026</p>
                </div>
                <div className="space-y-2.5">
                  {checks.map((item) => (
                    <div key={item} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                      <span className="grid size-5 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-3.5" strokeWidth={3} /></span>{item}
                    </div>
                  ))}
                </div>
                <div className="flex items-end justify-between rounded-xl bg-teal-50 p-4">
                  <div><p className="text-xs font-bold uppercase tracking-wider text-teal-700">Estimated subsidy</p><p className="mt-1 text-2xl font-extrabold text-navy-900">NT$600</p></div>
                  <WalletCards className="size-7 text-teal-700" />
                </div>
              </div>
            </Card>
          </div>
        </PageContainer>
      </section>

      <section className="bg-cloud">
        <PageContainer className="py-14 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-teal-700">One connected service</p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-navy-900">From policy question to payment status</h2>
            <p className="mt-4 leading-7 text-slate-600">Clear steps for citizens. Structured evidence and accountable controls for reviewers.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {features.map(({ icon: Icon, ...feature }, index) => (
              <Card key={feature.title} className="group flex min-h-72 flex-col p-6 transition hover:-translate-y-1 hover:border-navy-100 hover:shadow-float">
                <div className="flex items-center justify-between">
                  <span className="grid size-12 place-items-center rounded-xl bg-navy-50 text-navy-700"><Icon className="size-6" strokeWidth={1.8} /></span>
                  <span className="text-xs font-extrabold text-slate-300">0{index + 1}</span>
                </div>
                <h3 className="mt-6 text-xl font-bold text-navy-900">{feature.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{feature.description}</p>
                <Link className="-mx-2 mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-navy-700 group-hover:text-teal-700" href={feature.href}>{feature.link}<ArrowRight className="size-4" /></Link>
              </Card>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="border-y border-line bg-white">
        <PageContainer className="grid items-center gap-8 py-12 md:grid-cols-[1fr_auto]">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck className="size-6" /></span>
            <div>
              <h2 className="text-xl font-bold text-navy-900">Authority stays in the right place</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">AI retrieves policy and helps explain evidence. Deterministic rules evaluate eligibility. Government workflow authorizes approval and the mock treasury controls payment. Exceptional cases stay with human reviewers.</p>
            </div>
          </div>
          <Button asChild variant="outline"><Link href="/login">Explore the workflow <ArrowRight className="size-4" /></Link></Button>
        </PageContainer>
      </section>
    </>
  );
}
