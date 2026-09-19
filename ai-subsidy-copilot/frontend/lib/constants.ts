export const APPLICATION_STEPS = [
  { key: "identity", label: "Identity", shortLabel: "Identity" },
  { key: "details", label: "Applicant details", shortLabel: "Details" },
  { key: "documents", label: "Documents", shortLabel: "Docs" },
  { key: "review", label: "Rule check", shortLabel: "Check" },
  { key: "submit", label: "Submit", shortLabel: "Submit" },
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const ACCEPTED_DOCUMENT_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.webp";

export const DEMO_DISCLAIMER = "Demo system — not an official government service.";

export const SPECIAL_SUBTYPES = ["低收入戶", "中低收入戶", "獨力負擔家計者", "身心障礙者", "原住民", "新住民", "就業服務法第24條第1項各款情形"];
export const LANGUAGE_SUBTYPES = ["原住民族語言能力認證", "臺灣台語語言能力認證", "客語能力認證"];

export const CURRENCY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "TWD", label: "新臺幣" }, { value: "USD", label: "美金" }, { value: "JPY", label: "日圓" },
  { value: "EUR", label: "歐元" }, { value: "AUD", label: "澳幣" }, { value: "HKD", label: "港幣" }, { value: "other", label: "其他" },
];
export const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "general", label: "通用型" }, { value: "image", label: "影像類" }, { value: "office", label: "辦公類" },
  { value: "learning", label: "學習類" }, { value: "other", label: "其他類" },
];

/** Per-document guidance shown next to each upload slot (ported from the OCR apply form). */
export const DOCUMENT_HINTS: Record<string, string> = {
  id_card: "請提供清晰照片，須能辨識姓名、出生年月日、身分證字號與設籍新竹市住址。正反面可分開上傳多張。",
  receipt: "官方收據（訂閱人姓名/信箱、完整工具名稱、公司、日期、期間、原始費用、付款方式）、換算新臺幣與繳款憑證（出帳帳單）；刷卡請附卡號末四碼與姓名畫面，其餘卡號請遮蔽。可上傳多張。",
  passbook: "拍照或掃描存摺封面，內容完整、文字數字清晰，避免模糊、反光或裁切。戶名須為本人。",
  declaration: "切結書請親筆簽名後拍照或掃描上傳，字跡須清晰可辨識。",
  cultural_proof: "特定對象或文化語言保存者的證明文件（非此二類免附）。",
  payer_declaration: "父母、配偶或法定代理人代為支付者，須由付款人與申請人親筆簽名後上傳。",
};
