import type { SourceApplicant } from "@/lib/types";

/** Applicant fields the server requires before submission (mirrors REQUIRED_APPLICANT_FIELDS). */
export const REQUIRED_FIELDS: Array<[keyof SourceApplicant, string]> = [
  ["phone", "聯絡電話"],
  ["birth_date", "出生日期"],
  ["household_address", "戶籍地址"],
  ["mailing_address", "通訊地址"],
  ["applied_tool_name", "軟體名稱"],
  ["software_company", "軟體公司名稱"],
  ["purchase_date", "購買日期"],
  ["original_currency", "原始費用幣別"],
  ["original_amount", "原始費用"],
  ["declared_amount", "換算新臺幣"],
];

export function missingApplicantFields(data?: SourceApplicant | null): string[] {
  const missing = REQUIRED_FIELDS.filter(([key]) => !data?.[key]).map(([, label]) => label);
  if (data?.applicant_type && data.applicant_type !== "normal" && !data.applicant_subtype) missing.push("身分類別");
  return missing;
}

export const OPEN_STATUSES = ["DRAFT", "SUBMITTED", "VERIFYING", "MANUAL_REVIEW", "REQUESTED_INFORMATION"];
export const CANCELLABLE_STATUSES = OPEN_STATUSES;
