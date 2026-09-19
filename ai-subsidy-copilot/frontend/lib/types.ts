export type ApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "VERIFYING"
  | "MANUAL_REVIEW"
  | "REQUESTED_INFORMATION"
  | "APPROVED"
  | "REJECTED"
  | "PAYMENT_SCHEDULED"
  | "PAID"
  | "CANCELLED";

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

export type RuleResult = "PASS" | "REVIEW" | "NEED_SUPPLEMENT" | "REJECT" | "FRAUD_RISK";

export interface EligibilityCheck {
  rule: string;
  name?: string | null;
  passed: boolean | null;
  message: string;
  blocking?: boolean;
  requires_manual_review?: boolean;
  result?: RuleResult | null;
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
  ai_result?: RuleResult | null;
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
  requested_amount_twd?: number | null;
  approved_amount_twd?: number | null;
  eligibility_result?: EligibilityResult | string | null;
  eligibility_reasons_json?: EligibilityCheck[] | Record<string, unknown> | null;
  policy_citations?: PolicyCitation[];
  risk_level: RiskLevel;
  risk_reasons?: string[];
  flagged_for_check?: boolean;
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
export type ApplicantType = "normal" | "special" | "language";
export type PaymentType = "monthly" | "annual";
export type SoftwareCategory = "general" | "image" | "office" | "learning" | "other";
export type Currency = "TWD" | "USD" | "JPY" | "EUR" | "AUD" | "HKD" | "other";

/** The applicant form. `id_number` is write-only: it is hashed by the server and never returned. */
export interface SourceApplicant {
  id_number?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  household_address?: string | null;
  mailing_address?: string | null;
  applicant_type?: ApplicantType;
  applicant_subtype?: string | null;
  payment_type?: PaymentType;
  software_category?: SoftwareCategory;
  applied_tool_name?: string | null;
  software_company?: string | null;
  purchase_date?: string | null;
  is_own_credit_card?: boolean;
  original_currency?: Currency | null;
  original_amount?: number | null;
  declared_amount?: number | null;
}

export interface SourceRule { id: string; name: string; condition: string; data_source: string; ocr_field: string | null; confidence: number | null; status: string; result: RuleResult | null; reason: string; disposition: RuleResult; risk?: string }
export interface SourceSubsidy { applicant_category?: string; subsidy_amount: number | null; eligible_amount: number | null; subsidy_rate: number | null; subsidy_cap: number | null; source?: string | null; unknown: boolean }
export interface CrossValidationRow { check: string; label: string; a_source: string; a_value: unknown; b_source: string; b_value: unknown; result: "MATCH" | "PARTIAL_MATCH" | "MISMATCH" | "UNKNOWN" }
export interface SourceDocumentRecord { id: string; document_type: SourceDocumentType; filename: string; content_type: string; size_bytes: number; ocr_status: string; active: boolean; created_at: string; ocr_data?: Record<string, unknown>; sha256?: string }
export interface RequiredDocument { document_type: SourceDocumentType; label: string; multiple: boolean; uploaded_count: number }
export interface MissingDocument { document_type: SourceDocumentType; label: string; reason: string }

export interface SourceEvaluation {
  result: RuleResult;
  error?: string;
  policy_notice: string;
  evaluated_at: string;
  documents_required: boolean;
  rules?: SourceRule[];
  cross_validation?: CrossValidationRow[];
  applicant_data?: Record<string, unknown>;
  ocr_data?: Record<string, Record<string, unknown>>;
  knowledge_base_data?: { tool?: { product_name: string; company: string; category: string | null; country_or_region: string; eligible: boolean; prohibited_reason: string | null; last_verified_at: string } | null; is_aggregator?: boolean; aggregator_name?: string | null; is_official_source?: boolean | null };
  confidence_sources?: { ocr: Record<string, number | null>; knowledge_base: number; rule_engine: number; note: string };
  subsidy?: SourceSubsidy;
  supplement_center?: { items: Array<{ rule_id: string; missing_item: string; reason: string }>; deadline?: string };
}

export interface SourceReview {
  applicant_data: SourceApplicant;
  documents: SourceDocumentRecord[];
  evaluation: SourceEvaluation;
  required_documents: RequiredDocument[];
  missing_documents: MissingDocument[];
}

export interface ApplicationStatusInfo { public_id: string; status: ApplicationStatus; information_request: string | null; estimated_subsidy_twd: number | null; approved_amount_twd: number | null; updated_at: string }

/** Raw, unsaved applicant-form values sent only with the next chat request. */
export interface SourceIntakeDraftFields {
  id_number?: string;
  phone?: string;
  birth_date?: string;
  household_address?: string;
  mailing_address?: string;
  applicant_type?: string;
  applicant_subtype?: string;
  payment_type?: string;
  software_category?: string;
  applied_tool_name?: string;
  software_company?: string;
  purchase_date?: string;
  is_own_credit_card?: boolean;
  original_currency?: string;
  original_amount?: string;
  declared_amount?: string;
}

export interface SourceIntakeDraftContext {
  kind: "source_intake";
  fields: SourceIntakeDraftFields;
}

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

export interface AgentChatRequest {
  user_id: string;
  application_id?: string;
  message: string;
  draft_context?: SourceIntakeDraftContext;
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
  participation_optional: boolean;
  modules: Array<{
    module_id: string;
    completed: boolean;
    score?: number | null;
    attempts?: number;
  }>;
}

export type SafetyEngagementEvent =
  | "CHAT_REMINDER_VIEWED"
  | "PRACTICE_SHOWN"
  | "PRACTICE_ANSWERED"
  | "PRACTICE_SKIPPED"
  | "RAG_FOLLOWUP_OPENED";

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
  cancelled?: number;
  total_approved_subsidy: number;
  total_paid_amount: number;
  documents_uploaded: number;
  documents_ocr_processed: number;
  ocr_fields_extracted: number;
  applications_submitted: number;
  rules_total_checked: number;
  rules_auto_passed: number;
  issues_found: number;
  supplement_notifications_sent: number;
  applications_needing_human_review: number;
  estimated_minutes_saved: number;
  assumption_note: string;
}

export interface AdminApplicationList {
  items: AdminApplicationRow[];
  total: number;
}

export interface AdminApplicationRow {
  public_id: string;
  applicant: string;
  product: string | null;
  applicant_type?: ApplicantType | null;
  ai_result?: RuleResult | null;
  flagged_for_check?: boolean;
  requested_amount_twd: number | null;
  approved_amount_twd: number | null;
  risk_level: RiskLevel;
  status: ApplicationStatus;
  submitted_at: string | null;
  created_at: string;
}
