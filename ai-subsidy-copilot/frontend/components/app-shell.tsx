"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ChevronDown, ExternalLink, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { DEMO_DISCLAIMER } from "@/lib/constants";
import { useSession } from "@/contexts/session-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

export function GovernmentLogoPlaceholder({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy-700 text-white shadow-sm" aria-hidden="true">
        <Building2 className="size-5" strokeWidth={1.8} />
      </span>
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Digital Services Lab</span>
          <span className="block text-sm font-extrabold tracking-tight text-navy-900">AI Subsidy Copilot</span>
        </span>
      ) : null}
    </span>
  );
}

export function DemoBanner() {
  return (
    <div className="relative z-50 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-950 sm:text-sm">
      <span className="mr-2 inline-flex rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">Demo</span>
      {DEMO_DISCLAIMER}
    </div>
  );
}

const citizenNav = [
  { href: "/apply", label: "Apply" },
  { href: "/safety", label: "AI safety" },
  { href: "/track", label: "Track" },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearSession } = useSession();
  const [open, setOpen] = useState(false);
  const isAdmin = pathname.startsWith("/admin");

  const logout = () => {
    clearSession();
    setOpen(false);
    router.push("/login");
  };

  return (
    <>
      <DemoBanner />
      <header className="sticky top-0 z-40 border-b border-line/90 bg-white/95 shadow-[0_1px_0_rgba(16,42,67,.03)] backdrop-blur" aria-label="Main navigation">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
          <Link className="inline-flex min-h-11 items-center" href={isAdmin ? "/admin" : "/"} aria-label="AI Subsidy Copilot home">
            <GovernmentLogoPlaceholder />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label={isAdmin ? "Reviewer navigation" : "Citizen navigation"}>
            {isAdmin ? (
              <>
                <Link className="inline-flex min-h-11 items-center rounded-lg bg-navy-50 px-3 py-2 text-sm font-semibold text-navy-800" href="/admin">Applications</Link>
                <span className="mx-2 h-5 w-px bg-line" />
                <Link className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-navy-900" href="/">
                  Citizen portal <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
              </>
            ) : (
              citizenNav.map((item) => (
                <Link
                  key={item.href}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold",
                    pathname.startsWith(item.href)
                      ? "bg-navy-50 text-navy-800"
                      : "text-slate-600 hover:bg-slate-100 hover:text-navy-900",
                  )}
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))
            )}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {isAdmin ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800">
                <ShieldCheck className="size-4" aria-hidden="true" /> Demo reviewer console
              </span>
            ) : user ? (
              <div className="group relative">
                <button className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-left hover:bg-slate-50" type="button">
                  <span className="grid size-7 place-items-center rounded-full bg-teal-100 text-xs font-extrabold text-teal-800">{user.name.split(" ").map((part) => part[0]).join("")}</span>
                  <span>
                    <span className="block text-xs font-bold text-navy-900">{user.name}</span>
                    <span className="block text-[10px] text-slate-500">{user.government_id_masked}</span>
                  </span>
                  <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
                </button>
                <div className="invisible absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-line bg-white p-1 opacity-0 shadow-card transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <button onClick={logout} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100" type="button">
                    <LogOut className="size-4" aria-hidden="true" /> Switch applicant
                  </button>
                </div>
              </div>
            ) : (
              <Button asChild size="sm"><Link href="/login">Demo login</Link></Button>
            )}
          </div>

          <button
            className="grid size-10 place-items-center rounded-lg border border-line bg-white text-navy-800 md:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            type="button"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open ? (
          <div className="border-t border-line bg-white px-4 py-3 md:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col gap-1">
              {(isAdmin ? [{ href: "/admin", label: "Applications" }, { href: "/", label: "Citizen portal" }] : citizenNav).map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-sm font-semibold text-navy-800 hover:bg-navy-50">
                  {item.label}
                </Link>
              ))}
              {user && !isAdmin ? (
                <button onClick={logout} className="flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50" type="button">
                  <LogOut className="size-4" /> Switch applicant
                </button>
              ) : null}
            </nav>
          </div>
        ) : null}
      </header>
    </>
  );
}

export function AppFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-2"><Building2 className="size-4" aria-hidden="true" /><span>Fictional Digital Services Lab · 2026 demo program</span></div>
        <p>AI assists. Rules determine eligibility. Government systems authorize payment.</p>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1">{children}</main>
      <AppFooter />
    </div>
  );
}

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8", className)}>{children}</div>;
}
