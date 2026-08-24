"use client";

import { useState, type FormEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui";

export function ChatInput({ onSend, disabled, placeholder = "Ask about the demo subsidy policy…" }: { onSend: (message: string) => void | Promise<void>; disabled?: boolean; placeholder?: string }) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const message = value.trim();
    if (!message || disabled) return;
    setValue("");
    void onSend(message);
  }
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor="assistant-message" className="sr-only">Message the application assistant</label>
        <textarea id="assistant-message" rows={1} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={disabled} placeholder={placeholder} className="max-h-28 min-h-11 w-full resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 shadow-sm placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-3 focus:ring-sky-500/15 disabled:bg-slate-100" />
      </div>
      <Button size="icon" type="submit" disabled={disabled || !value.trim()} aria-label="Send message"><SendHorizontal className="size-4" /></Button>
    </form>
  );
}

export function QuickReplyButtons({ options, onSelect, disabled }: { options: string[]; onSelect: (value: string) => void; disabled?: boolean }) {
  if (!options.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2" aria-label="Suggested replies">
      {options.map((option) => <button key={option} disabled={disabled} onClick={() => onSelect(option)} className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-700 hover:border-teal-600 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-50" type="button">{option}</button>)}
    </div>
  );
}
