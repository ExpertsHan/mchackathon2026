import type { SourceApplicant } from "@/lib/types";

/** Applicant fields the server requires before submission (mirrors REQUIRED_APPLICANT_FIELDS). */
export const REQUIRED_FIELDS: Array<[keyof SourceApplicant, string]> = [
  ["name", "姓名"],
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

export type SubmissionIssueTarget = "details" | "documents" | "review" | "submit";

export interface SubmissionIssue {
  summary: string;
  missing: string[];
  action: string;
  target: SubmissionIssueTarget;
}

function errorProperty(error: unknown, key: "code" | "message"): string | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function missingItemsFromMessage(message: string): string[] {
  const separator = message.indexOf("：");
  if (separator < 0) return [];
  return message
    .slice(separator + 1)
    .split(/[、,]/)
    .map((item) => item.trim().replace(/[。.]$/, ""))
    .filter(Boolean);
}

/** Turn a failed submit response into instructions a citizen can act on. */
export function submissionIssueFromError(
  error: unknown,
  applicantMissing: string[],
  documentMissing: string[],
): SubmissionIssue {
  const code = errorProperty(error, "code");
  const message = errorProperty(error, "message") ?? "送出時發生未預期的錯誤，請再試一次。";

  if (code === "APPLICANT_DATA_INCOMPLETE") {
    return {
      summary: "申請人資料尚未完整，因此這次沒有送出。",
      missing: applicantMissing.length ? applicantMissing : missingItemsFromMessage(message),
      action: "請回到步驟 2「申請人資料」，補填或修正後先按「儲存申請資料」，再重新送出。",
      target: "details",
    };
  }
  if (code === "DOCUMENTS_INCOMPLETE") {
    return {
      summary: "必要文件尚未齊全，因此這次沒有送出。",
      missing: documentMissing.length ? documentMissing : missingItemsFromMessage(message),
      action: "請回到步驟 3「上傳文件」，補上列出的文件，等待上傳完成後再重新送出。",
      target: "documents",
    };
  }
  if (code === "SOURCE_REVIEW_UNAVAILABLE") {
    return {
      summary: message,
      missing: [],
      action: "資料不需重填。請到步驟 4 按「重新檢查」，完成後再送出；若仍失敗，請稍後再試。",
      target: "review",
    };
  }
  return {
    summary: message,
    missing: [],
    action: "請確認上方訊息後再試一次；已儲存的申請資料與文件不會消失。",
    target: "submit",
  };
}

export const OPEN_STATUSES = ["DRAFT", "SUBMITTED", "VERIFYING", "MANUAL_REVIEW", "REQUESTED_INFORMATION"];
export const CANCELLABLE_STATUSES = OPEN_STATUSES;
