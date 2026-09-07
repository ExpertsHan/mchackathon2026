export type ApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "VERIFYING"
  | "MANUAL_REVIEW"
  | "REQUESTED_INFORMATION"
  | "APPROVED"
  | "REJECTED"
  | "PAYMENT_SCHEDULED"
  | "PAID";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface DemoUser {
  id: string;
  name: string;
  government_id_masked: string;
  age: number;
  email?: string | null;
  identity_verified: boolean;
}

export interface DemoLoginResponse {
  user: DemoUser;
  demo_token: string;
  notice?: string;
}

export interface Subscription {
  id?: string;
  provider: string | null;
  product: string | null;
  amount?: number | null;
  currency?: string | null;
  amount_twd?: number | null;
  purchase_date?: string | null;
  receipt_filename?: string | null;
  receipt_hash?: string | null;
  receipt_uploaded?: boolean;
  receipt_reference?: string | null;
  account_email?: string | null;
  extraction_confidence?: number | null;
  extraction_json?: Record<string, unknown>;
  extraction_warnings_json?: string[];
  suspicious_content?: boolean;
}

export interface EligibilityCheck {
  rule: string;
  passed: boolean | null;
  message: string;
  requires_manual_review?: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  provisional?: boolean;
  requires_manual_review: boolean;
  approved_amount_twd: number;
  estimated_amount_twd: number;
  checks: EligibilityCheck[];
  risk_level?: RiskLevel;
  risk_reasons?: string[];
}

export interface PolicyCitation {
  document: string;
  section: string;
  article?: string | null;
  excerpt?: string | null;
  chunk_id?: string | null;
}

export interface Payment {
  id?: string;
  amount_twd: number;
  status: string;
  transaction_id?: string | null;
  scheduled_at?: string | null;
  paid_at?: string | null;
}

export interface AuditLog {
  id: string;
  actor_type: string;
  actor_identifier?: string | null;
  action: string;
  details_json?: Record<string, unknown> | null;
  created_at: string;
}

export interface Application {
  id?: string;
  public_id: string;
  user_id: string;
  user?: DemoUser | null;
  applicant?: DemoUser | null;
  subscription?: Subscription | null;
  requested_amount_twd?: number | null;
  approved_amount_twd?: number | null;
  eligibility_result?: EligibilityResult | string | null;
  eligibility_reasons_json?: EligibilityCheck[] | Record<string, unknown> | null;
  policy_citations?: PolicyCitation[];
  risk_level: RiskLevel;
  risk_reasons?: string[];
  status: ApplicationStatus;
  review_reason?: string | null;
  requested_information?: string | null;
  payment?: Payment | null;
  audit_logs?: AuditLog[];
  safety_progress?: SafetyProgress | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  source_review?: SourceReview | null;
}

export type SourceDocumentType = "receipt" | "id_card" | "passbook" | "declaration" | "cultural_proof" | "payer_declaration";
export interface SourceApplicant { birth_date?: string | null; household_address?: string | null; applicant_type?: "normal" | "special" | "language"; payment_type?: "monthly" | "annual"; software_category?: "general" | "image" | "office" | "learning" | "other"; purchase_date?: string | null; declared_amount?: number | null; is_own_credit_card?: boolean; }
export interface SourceRule { id: string; name: string; condition: string; data_source: string; ocr_field: string | null; confidence: number | null; status: string; result: string | null; reason: string; disposition: string; }
export interface SourceReview { applicant_data: SourceApplicant; documents: Array<{ id: string; document_type: SourceDocumentType; filename: string; content_type: string; size_bytes: number; ocr_status: string; active: boolean; created_at: string; ocr_data?: Record<string, unknown>; sha256?: string; }>; evaluation: { result: string; error?: string; policy_notice: string; evaluated_at: string; documents_required: boolean; rules?: SourceRule[]; cross_validation?: Array<{ check: string; label: string; a_source: string; a_value: unknown; b_source: string; b_value: unknown; result: string }>; applicant_data?: Record<string, unknown>; ocr_data?: Record<string, unknown>; knowledge_base_data?: Record<string, unknown>; confidence_sources?: { ocr: Record<string, number | null>; knowledge_base: number; rule_engine: number; note: string }; subsidy?: { subsidy_amount: number | null; eligible_amount: number | null; subsidy_rate: number | null; subsidy_cap: number | null; source: string | null; unknown: boolean }; supplement_center?: { items: Array<{ rule_id: string; missing_item: string; reason: string }>; deadline?: string }; }; }

export interface TimelineEvent {
  key?: string;
  title: string;
  description?: string | null;
  status?: "complete" | "current" | "upcoming" | "warning";
  occurred_at?: string | null;
  actor_type?: string | null;
}

export interface ChatMessageData {
  id: string;
  role: "assistant" | "user";
  content: string;
  citations?: PolicyCitation[];
  tone?: "default" | "success" | "warning";
}

export interface AgentResponse {
  message: string;
  citations: PolicyCitation[];
  suggested_actions: SuggestedAction[];
  ai_available?: boolean;
  state?: Record<string, unknown>;
}

export interface AgentHistoryMessage {
  role: "assistant" | "user";
  content: string;
}

export type AgentStreamEvent =
  | { type: "start"; request_id: string }
  | { type: "delta"; text: string }
  | { type: "citations"; citations: PolicyCitation[] }
  | { type: "suggested_actions"; suggested_actions: SuggestedAction[] }
  | {
      type: "done";
      agent_state: Record<string, unknown>;
      ai_used: boolean;
      notice?: string | null;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface SuggestedAction {
  type: string;
  label: string;
  href?: string | null;
  value?: string | null;
}

export interface SafetyChoice {
  id: string;
  label: string;
}

export interface SafetyModuleData {
  id: string;
  slug: string;
  title: string;
  content: string;
  required: boolean;
  order_index: number;
  question: string;
  choices: SafetyChoice[];
  completed?: boolean;
  score?: number | null;
  attempts?: number;
}

export interface SafetyProgress {
  completed_count: number;
  required_count: number;
  complete: boolean;
  modules: Array<{
    module_id: string;
    completed: boolean;
    score?: number | null;
    attempts?: number;
  }>;
}

export interface QuizResult {
  correct: boolean;
  completed: boolean;
  score: number;
  attempts?: number;
  explanation: string;
  progress?: SafetyProgress;
}

export interface AdminStats {
  total_applications: number;
  draft?: number;
  submitted: number;
  verifying: number;
  manual_review: number;
  requested_information?: number;
  approved: number;
  rejected: number;
  payment_scheduled?: number;
  paid: number;
  total_approved_subsidy: number;
  total_paid_amount: number;
}

export interface AdminApplicationList {
  items: AdminApplicationRow[];
  total: number;
}

export interface AdminApplicationRow {
  public_id: string;
  applicant: string;
  product: string | null;
  requested_amount_twd: number | null;
  approved_amount_twd: number | null;
  risk_level: RiskLevel;
  status: ApplicationStatus;
  submitted_at: string | null;
  created_at: string;
}

export interface ProductOption {
  provider: string;
  product: string;
  description: string;
  eligible: boolean;
}
