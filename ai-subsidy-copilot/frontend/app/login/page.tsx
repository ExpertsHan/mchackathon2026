"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card, SectionHeading } from "@/components/ui";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useSession } from "@/contexts/session-context";
import { validatedPostLoginPath } from "@/lib/demo-auth";

export default function LoginPage() {
  const router = useRouter();
  const { setDemoSession } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const session = await api.startApplicant();
      setDemoSession(session.user, session.demo_token);
      const requestedDestination = new URLSearchParams(window.location.search).get("next");
      router.push(validatedPostLoginPath(requestedDestination));
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }

  return (
    <PageContainer className="max-w-xl">
      <SectionHeading eyebrow="AI領航青年數位工具補助" title="開始線上申請" description="不需要選擇任何範例身分，直接填寫您自己的申請資料並上傳文件即可。" />
      <Card className="mt-8 p-6">
        <p className="text-sm leading-6 text-slate-600">建議從 LINE 官方帳號輸入「申請」取得專屬連結，申請進度與審核結果會直接通知到您的 LINE。若直接在此開始，將不會綁定 LINE 通知。</p>
        {error ? <Alert className="mt-4" tone="error" title="無法開始申請">{error}</Alert> : null}
        <Button className="mt-5 w-full" loading={loading} onClick={() => void start()}>
          開始申請 <ChevronRight className="size-4" />
        </Button>
      </Card>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-line bg-white p-4 text-xs leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
        本系統為示範用途，不會連接真實的戶政、銀行或稅務系統。
      </div>
    </PageContainer>
  );
}
