import type { Calendar } from "lucide-react";

export function KeyValueGrid({ items }: { items: Array<{ label: string; value: React.ReactNode; icon?: typeof Calendar }> }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
      {items.map(({ label, value, icon: Icon }) => (
        <div className="bg-white p-4" key={label}><dt className="flex items-center gap-2 text-xs font-semibold text-slate-500">{Icon ? <Icon className="size-3.5" /> : null}{label}</dt><dd className="mt-1.5 break-words text-sm font-bold text-navy-900">{value}</dd></div>
      ))}
    </dl>
  );
}
