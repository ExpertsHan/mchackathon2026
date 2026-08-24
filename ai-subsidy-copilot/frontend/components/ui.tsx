import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "border-navy-700 bg-navy-700 text-white shadow-sm hover:border-navy-800 hover:bg-navy-800",
  secondary: "border-teal-700 bg-teal-700 text-white shadow-sm hover:border-teal-800 hover:bg-teal-800",
  outline: "border-line bg-white text-navy-800 hover:border-navy-600 hover:bg-navy-50",
  ghost: "border-transparent bg-transparent text-navy-700 hover:bg-navy-50",
  danger: "border-red-700 bg-red-700 text-white shadow-sm hover:bg-red-800",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 py-2 text-sm",
  md: "min-h-11 px-4 py-2.5 text-sm",
  lg: "min-h-12 px-5 py-3 text-base",
  icon: "size-11 p-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const styles = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg border font-semibold leading-none",
    "focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sky-500/40",
    "disabled:pointer-events-none disabled:opacity-50",
    buttonStyles[variant],
    buttonSizes[size],
    className,
  );
  if (asChild) {
    return (
      <Slot
        className={styles}
        aria-disabled={disabled || loading || undefined}
        {...props}
      >
        {children}
      </Slot>
    );
  }
  return (
    <button
      className={styles}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-white shadow-card", className)}
      {...props}
    />
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">{eyebrow}</p>
        ) : null}
        <h1 className="text-balance text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    error: "border-red-200 bg-red-50 text-red-950",
  };
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4 text-sm", tones[tone], className)} role={tone === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 leading-6">
        {title ? <p className="font-bold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-40 items-center justify-center gap-3 text-sm font-medium text-slate-600", className)} role="status">
      <LoaderCircle className="size-5 animate-spin text-teal-700" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center px-6 py-10 text-center">
      {icon ? <div className="mb-4 grid size-12 place-items-center rounded-xl bg-navy-50 text-navy-700">{icon}</div> : null}
      <h2 className="text-lg font-bold text-navy-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-navy-900">
      {children}
    </label>
  );
}

export const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm placeholder:text-slate-400 hover:border-slate-400 focus:border-sky-600 focus:outline-none focus:ring-3 focus:ring-sky-500/15 disabled:bg-slate-100 disabled:text-slate-500";
