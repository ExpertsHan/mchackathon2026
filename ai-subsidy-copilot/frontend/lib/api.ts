import type {
  AdminApplicationList,
  AdminApplicationRow,
  AdminStats,
  AgentResponse,
  Application,
  AuditLog,
  DemoUser,
  DemoLoginResponse,
  EligibilityResult,
  PolicyCitation,
  QuizResult,
  SafetyModuleData,
  SafetyProgress,
  Subscription,
  TimelineEvent,
} from "@/lib/types";
import { readDemoToken } from "@/lib/demo-auth";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "REQUEST_FAILED", status = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrap<T>(value: unknown, ...keys: string[]): T {
  if (isRecord(value)) {
    for (const key of keys) {
      if (key in value) return value[key] as T;
    }
  }
  return value as T;
}

function normalizeEligibility(value: unknown): EligibilityResult | null {
  if (!isRecord(value)) return null;
  return {
    eligible: Boolean(value.eligible),
    provisional: Boolean(value.provisionally_eligible ?? value.provisional),
    requires_manual_review: Boolean(value.requires_manual_review),
    approved_amount_twd: Number(value.approved_amount_twd ?? 0),
    estimated_amount_twd: Number(value.estimated_amount_twd ?? value.approved_amount_twd ?? 0),
    checks: Array.isArray(value.checks) ? value.checks as EligibilityResult["checks"] : [],
    risk_level: (value.risk_level as EligibilityResult["risk_level"]) ?? "LOW",
    risk_reasons: Array.isArray(value.risk_reasons) ? value.risk_reasons as string[] : [],
  };
}

function normalizeSafetyProgress(value: unknown): SafetyProgress | null {
  if (!isRecord(value)) return null;
  return {
    completed_count: Number(value.completed_required ?? value.completed_count ?? 0),
    required_count: Number(value.total_required ?? value.required_count ?? 0),
    complete: Boolean(value.all_required_complete ?? value.complete),
    modules: Array.isArray(value.modules)
      ? value.modules.map((item) => {
          const row = isRecord(item) ? item : {};
          return {
            module_id: String(row.module_id ?? ""),
            completed: Boolean(row.completed),
            score: row.score === null || row.score === undefined ? null : Number(row.score),
            attempts: Number(row.attempts ?? 0),
          };
        })
      : [],
  };
}

function normalizeApplication(value: unknown): Application {
  const detail = isRecord(value) ? value : {};
  const base = isRecord(detail.application) ? detail.application : detail;
  const application = { ...base } as unknown as Application;
  const eligibility = normalizeEligibility(detail.eligibility);
  const reviewerReason = base.reviewer_reason ?? base.review_reason;
  const informationRequest = base.information_request ?? base.requested_information;
  return {
    ...application,
    applicant: isRecord(detail.applicant) ? detail.applicant as unknown as DemoUser : application.applicant,
    user: isRecord(detail.applicant) ? detail.applicant as unknown as DemoUser : application.user,
    subscription: isRecord(detail.subscription) ? detail.subscription as unknown as Subscription : application.subscription,
    eligibility_result: eligibility ?? application.eligibility_result,
    policy_citations: Array.isArray(detail.citations)
      ? detail.citations as PolicyCitation[]
      : Array.isArray(base.policy_citations_json) ? base.policy_citations_json as PolicyCitation[] : application.policy_citations,
    payment: isRecord(detail.payment) ? detail.payment as unknown as Application["payment"] : application.payment,
    audit_logs: Array.isArray(detail.audit_logs) ? detail.audit_logs as AuditLog[] : application.audit_logs,
    safety_progress: normalizeSafetyProgress(detail.safety_progress) ?? application.safety_progress,
    review_reason: typeof reviewerReason === "string" ? reviewerReason : application.review_reason,
    requested_information: typeof informationRequest === "string" ? informationRequest : application.requested_information,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  const demoToken = readDemoToken();
  const isAdminRequest = path.startsWith("/api/admin");
  const isPublicBootstrapRequest =
    path === "/health" ||
    path === "/api/demo/users" ||
    path === "/api/demo/login" ||
    path === "/api/demo/reset" ||
    path === "/api/policy/search";
  if (demoToken && !isAdminRequest && !isPublicBootstrapRequest && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${demoToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      "The demo service is unavailable. Start the backend, then try again.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const record = isRecord(body) ? body : {};
    const nestedError = isRecord(record.error) ? record.error : {};
    const detail = isRecord(record.detail) ? record.detail : {};
    const message =
      (typeof nestedError.message === "string" && nestedError.message) ||
      (typeof detail.message === "string" && detail.message) ||
      (typeof record.detail === "string" && record.detail) ||
      (typeof record.message === "string" && record.message) ||
      (typeof body === "string" && body) ||
      `Request failed (${response.status}).`;
    const code =
      (typeof nestedError.code === "string" && nestedError.code) ||
      (typeof detail.code === "string" && detail.code) ||
      (typeof record.code === "string" && record.code) ||
      "REQUEST_FAILED";
    throw new ApiError(message, code, response.status);
  }

  return body as T;
}

export const api = {
  async health() {
    return request<{
      status: string;
      database: string;
      demo_mode: boolean;
      openai_configured: boolean;
    }>("/health");
  },

  async getDemoUsers() {
    const body = await request<unknown>("/api/demo/users");
    return unwrap<DemoUser[]>(body, "users", "items");
  },

  async loginDemoUser(userId: string) {
    const body = await request<unknown>("/api/demo/login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
    const record = isRecord(body) ? body : {};
    const user = unwrap<DemoUser>(body, "user", "applicant");
    const demoToken = typeof record.demo_token === "string" ? record.demo_token : "";
    if (!user?.id || !demoToken) {
      throw new ApiError("The demo login response did not include valid credentials.", "INVALID_DEMO_SESSION", 500);
    }
    return {
      user,
      demo_token: demoToken,
      notice: typeof record.notice === "string" ? record.notice : undefined,
    } satisfies DemoLoginResponse;
  },

  async resetDemo() {
    return request<{ message?: string; status?: string }>("/api/demo/reset", { method: "POST" });
  },

  async createApplication(userId: string) {
    const body = await request<unknown>("/api/applications", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
    return normalizeApplication(body);
  },

  async getApplication(publicId: string) {
    const body = await request<unknown>(`/api/applications/${encodeURIComponent(publicId)}`);
    return normalizeApplication(body);
  },

  async getUserApplications(userId: string) {
    const body = await request<unknown>(`/api/users/${encodeURIComponent(userId)}/applications`);
    return unwrap<Application[]>(body, "applications", "items");
  },

  async setSubscription(publicId: string, provider: string, product: string) {
    const body = await request<unknown>(
      `/api/applications/${encodeURIComponent(publicId)}/subscription`,
      {
        method: "POST",
        body: JSON.stringify({ provider, product }),
      },
    );
    return unwrap<Application | Subscription>(body, "application", "subscription");
  },

  async uploadReceipt(publicId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const body = await request<unknown>(
      `/api/applications/${encodeURIComponent(publicId)}/receipt`,
      { method: "POST", body: formData },
    );
    return unwrap<Application | Subscription>(body, "application", "subscription", "receipt");
  },

  async getReceipt(publicId: string) {
    const body = await request<unknown>(`/api/applications/${encodeURIComponent(publicId)}/receipt`);
    return unwrap<Subscription>(body, "receipt", "subscription");
  },

  async checkEligibility(publicId: string) {
    const body = await request<unknown>(
      `/api/applications/${encodeURIComponent(publicId)}/eligibility/check`,
      { method: "POST" },
    );
    return normalizeEligibility(unwrap<unknown>(body, "eligibility", "result")) as EligibilityResult;
  },

  async submitApplication(publicId: string) {
    const body = await request<unknown>(`/api/applications/${encodeURIComponent(publicId)}/submit`, {
      method: "POST",
    });
    return normalizeApplication(body);
  },

  async chat(payload: { user_id: string; application_id?: string; message: string }) {
    const body = await request<unknown>("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const response = unwrap<Partial<AgentResponse> & { agent_state?: Record<string, unknown>; ai_used?: boolean }>(body, "response");
    return {
      message: response.message ?? "I could not establish an answer from the current demo policy.",
      citations: response.citations ?? [],
      suggested_actions: response.suggested_actions ?? [],
      ai_available: response.ai_available ?? response.ai_used,
      state: response.state ?? response.agent_state,
    } satisfies AgentResponse;
  },

  async searchPolicy(query: string) {
    const body = await request<unknown>("/api/policy/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    return unwrap<{ answer?: string; citations: PolicyCitation[] }>(body, "result");
  },

  async getSafetyModules() {
    const body = await request<unknown>("/api/safety/modules");
    const modules = unwrap<unknown[]>(body, "modules", "items");
    return modules.map((value) => {
      const moduleRecord = isRecord(value) ? value : {};
      const choices = Array.isArray(moduleRecord.choices) ? moduleRecord.choices : [];
      return {
        id: String(moduleRecord.id ?? ""),
        slug: String(moduleRecord.slug ?? ""),
        title: String(moduleRecord.title ?? "AI Safety"),
        content: String(moduleRecord.content ?? ""),
        required: Boolean(moduleRecord.required),
        order_index: Number(moduleRecord.order_index ?? 0),
        question: String(moduleRecord.question ?? ""),
        choices: choices.map((value) => {
          const choice = isRecord(value) ? value : {};
          return { id: String(choice.id ?? ""), label: String(choice.label ?? choice.text ?? choice.id ?? "") };
        }),
      } satisfies SafetyModuleData;
    });
  },

  async getSafetyProgress(userId: string) {
    const body = await request<unknown>(`/api/users/${encodeURIComponent(userId)}/safety-progress`);
    return normalizeSafetyProgress(unwrap<unknown>(body, "progress")) as SafetyProgress;
  },

  async answerSafetyModule(moduleId: string, userId: string, choiceId: string) {
    const body = await request<unknown>(
      `/api/safety/modules/${encodeURIComponent(moduleId)}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ user_id: userId, answer: choiceId, choice_id: choiceId }),
      },
    );
    return unwrap<QuizResult>(body, "result");
  },

  async getTimeline(publicId: string) {
    const body = await request<unknown>(`/api/applications/${encodeURIComponent(publicId)}/timeline`);
    const events = unwrap<Array<TimelineEvent & { action?: string; label?: string; timestamp?: string; details?: Record<string, unknown> }>>(body, "timeline", "events");
    return events.map((event, index) => {
      const reasons = Array.isArray(event.details?.reasons) ? event.details.reasons.filter((item): item is string => typeof item === "string") : [];
      const failedRules = Array.isArray(event.details?.failed_rules) ? event.details.failed_rules.filter((item): item is string => typeof item === "string") : [];
      return {
        ...event,
        key: `${event.timestamp ?? event.occurred_at ?? "event"}-${event.action ?? event.label ?? "event"}-${index}`,
        title: event.label ?? event.title ?? event.action ?? "Application event",
        description: typeof event.details?.message === "string" ? event.details.message : typeof event.details?.reason === "string" ? event.details.reason : reasons.length ? reasons.join(" · ") : failedRules.length ? `Failed checks: ${failedRules.join(", ")}` : event.description,
        occurred_at: event.timestamp ?? event.occurred_at,
      };
    });
  },

  async getAdminStats() {
    const body = await request<unknown>("/api/admin/stats");
    return unwrap<AdminStats>(body, "stats");
  },

  async getAdminApplications(filters?: { status?: string; product?: string; risk?: string; search?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.product) params.set("product", filters.product);
    if (filters?.risk) params.set("risk_level", filters.risk);
    if (filters?.search) params.set("search", filters.search);
    const suffix = params.size ? `?${params.toString()}` : "";
    const body = await request<unknown>(`/api/admin/applications${suffix}`);
    const raw = unwrap<AdminApplicationRow[] | AdminApplicationList>(body, "applications");
    if (Array.isArray(raw)) return { items: raw, total: raw.length };
    return raw;
  },

  async getAdminApplication(publicId: string) {
    const body = await request<unknown>(`/api/admin/applications/${encodeURIComponent(publicId)}`);
    return normalizeApplication(body);
  },

  async runVerification(publicId: string) {
    const body = await request<unknown>(
      `/api/admin/applications/${encodeURIComponent(publicId)}/verify`,
      { method: "POST" },
    );
    return normalizeApplication(body);
  },

  async reviewAction(publicId: string, action: "approve" | "reject" | "request-info", reason: string, overrideReviewFlag = false) {
    const body = await request<unknown>(
      `/api/admin/applications/${encodeURIComponent(publicId)}/${action}`,
      { method: "POST", body: JSON.stringify({ reason, override_review_flag: overrideReviewFlag }) },
    );
    return normalizeApplication(body);
  },

  async processPayment(publicId: string) {
    const body = await request<unknown>(
      `/api/admin/applications/${encodeURIComponent(publicId)}/process-payment`,
      { method: "POST" },
    );
    return unwrap<Application["payment"]>(body, "payment");
  },

  async getAuditLogs(publicId: string) {
    const app = await this.getAdminApplication(publicId);
    return (app.audit_logs ?? []) as AuditLog[];
  },
};
