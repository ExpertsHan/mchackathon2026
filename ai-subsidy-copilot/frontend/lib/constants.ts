import type { ProductOption } from "@/lib/types";

export const PRODUCTS: ProductOption[] = [
  {
    provider: "OpenAI",
    product: "ChatGPT Plus",
    description: "Personal ChatGPT subscription",
    eligible: true,
  },
  {
    provider: "Anthropic",
    product: "Claude Pro",
    description: "Personal Claude subscription",
    eligible: true,
  },
  {
    provider: "Notion",
    product: "Notion AI",
    description: "AI features for a Notion workspace",
    eligible: true,
  },
  {
    provider: "Other",
    product: "Other",
    description: "Ask the assistant to check the policy",
    eligible: false,
  },
];

export const APPLICATION_STEPS = [
  { key: "identity", label: "Identity", shortLabel: "Identity" },
  { key: "subscription", label: "Subscription", shortLabel: "Tool" },
  { key: "receipt", label: "Receipt", shortLabel: "Receipt" },
  { key: "eligibility", label: "Eligibility", shortLabel: "Check" },
  { key: "safety", label: "AI Safety", shortLabel: "Safety" },
  { key: "submit", label: "Submit", shortLabel: "Submit" },
] as const;

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_RECEIPT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

export const DEMO_DISCLAIMER = "Demo system — not an official government service.";
