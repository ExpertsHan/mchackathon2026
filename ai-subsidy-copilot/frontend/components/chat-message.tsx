import { Bot, UserRound } from "lucide-react";
import type { ChatMessageData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PolicyCitationList } from "@/components/policy-citation";

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const assistant = message.role === "assistant";
  return (
    <article className={cn("flex gap-3", assistant ? "justify-start" : "justify-end")} aria-label={`${assistant ? "AI Subsidy Copilot" : "You"} said`}>
      {assistant ? <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-navy-700 text-white"><Bot className="size-4" /></span> : null}
      <div className={cn("max-w-[86%] sm:max-w-[78%]", !assistant && "order-first")}>
        <div className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
          assistant && message.tone === "success" ? "rounded-tl-sm border border-emerald-200 bg-emerald-50 text-emerald-950" :
          assistant && message.tone === "warning" ? "rounded-tl-sm border border-amber-200 bg-amber-50 text-amber-950" :
          assistant ? "rounded-tl-sm border border-navy-100 bg-navy-50 text-navy-950" : "rounded-tr-sm bg-navy-700 text-white",
        )}>
          {message.content.split("\n").map((line, index) => <p key={index} className={index ? "mt-2" : undefined}>{line}</p>)}
        </div>
        {assistant && message.citations?.length ? <PolicyCitationList className="mt-2" citations={message.citations} compact /> : null}
      </div>
      {!assistant ? <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-slate-200 text-slate-700"><UserRound className="size-4" /></span> : null}
    </article>
  );
}

export function TypingMessage({ label = "Checking current policy" }: { label?: string }) {
  return (
    <div className="flex gap-3" role="status" aria-label={`${label}…`}>
      <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-navy-700 text-white"><Bot className="size-4" /></span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-navy-100 bg-navy-50 px-4 py-3 text-xs font-semibold text-slate-600">
        {label}
        <span className="ml-1 size-1.5 animate-pulse-dot rounded-full bg-teal-700" />
        <span className="size-1.5 animate-pulse-dot rounded-full bg-teal-700 [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse-dot rounded-full bg-teal-700 [animation-delay:300ms]" />
      </div>
    </div>
  );
}
