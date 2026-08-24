"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Bot, ShieldCheck } from "lucide-react";
import type { ChatMessageData } from "@/lib/types";
import { ChatMessage, TypingMessage } from "@/components/chat-message";

export function ChatWindow({ messages, loading, loadingLabel, children }: { messages: ChatMessageData[]; loading?: boolean; loadingLabel?: string; children?: ReactNode }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, loading]);

  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card" aria-label="AI application assistant">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-navy-900 px-4 py-3.5 text-white sm:px-5">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><Bot className="size-5" /></span><div><h2 className="text-sm font-bold">Application assistant</h2><p className="text-[11px] text-slate-300">Policy-grounded guidance</p></div></div>
        <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-teal-100 sm:inline-flex"><ShieldCheck className="size-3.5" /> Rules stay authoritative</span>
      </div>
      <div className="scrollbar-subtle flex-1 space-y-5 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
        {loading ? <TypingMessage label={loadingLabel} /> : null}
        <div ref={endRef} />
      </div>
      {children ? <div className="border-t border-line bg-slate-50/80 p-3 sm:p-4">{children}</div> : null}
    </section>
  );
}
