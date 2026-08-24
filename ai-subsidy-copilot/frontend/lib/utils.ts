import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ApplicationStatus } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "TWD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace("NT$", "NT$");
}

export function formatReceiptAmount(amount?: number | null, currency?: string | null) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)}`.trim();
}

export function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", options ?? {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(value?: string | null) {
  return formatDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function humanize(value?: string | null) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusDescription(status: ApplicationStatus) {
  const descriptions: Record<ApplicationStatus, string> = {
    DRAFT: "Complete the required steps and submit your application.",
    SUBMITTED: "Your application was received and is queued for verification.",
    VERIFYING: "Evidence and eligibility checks are being verified.",
    MANUAL_REVIEW: "A government reviewer is examining this application.",
    REQUESTED_INFORMATION: "A reviewer needs more information before continuing.",
    APPROVED: "The application is approved. Payment can now be scheduled.",
    REJECTED: "The application did not meet the demo program requirements.",
    PAYMENT_SCHEDULED: "A mock payment has been scheduled by the treasury service.",
    PAID: "The mock subsidy payment is complete.",
  };
  return descriptions[status];
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function truncateHash(hash?: string | null) {
  if (!hash) return "—";
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}
