"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Alert, Button, FieldLabel, inputClassName } from "@/components/ui";
import { CATEGORY_OPTIONS, CURRENCY_OPTIONS, LANGUAGE_SUBTYPES, SPECIAL_SUBTYPES } from "@/lib/constants";
import { api } from "@/lib/api";
import { REQUIRED_FIELDS } from "@/lib/intake";
import type {
  ApplicantType,
  Currency,
  PaymentType,
  SoftwareCategory,
  SourceApplicant,
  SourceIntakeDraftContext,
  SourceIntakeDraftFields,
  SourceReview,
} from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface FormState {
  id_number: string;
  phone: string;
  birth_date: string;
  household_address: string;
  mailing_address: string;
  applicant_type: ApplicantType;
  applicant_subtype: string;
  payment_type: PaymentType;
  software_category: SoftwareCategory;
  applied_tool_name: string;
  software_company: string;
  purchase_date: string;
  is_own_credit_card: boolean;
  original_currency: Currency | "";
  original_amount: string;
  declared_amount: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

const ID_PATTERN = /^[A-Za-z][0-9A-Da-d][0-9]{8}$/;

function initialForm(initial?: SourceApplicant | null): FormState {
  return {
    id_number: "",
    phone: initial?.phone ?? "",
    birth_date: initial?.birth_date ?? "",
    household_address: initial?.household_address ?? "",
    mailing_address: initial?.mailing_address ?? "",
    applicant_type: initial?.applicant_type ?? "normal",
    applicant_subtype: initial?.applicant_subtype ?? "",
    payment_type: initial?.payment_type ?? "monthly",
    software_category: initial?.software_category ?? "general",
    applied_tool_name: initial?.applied_tool_name ?? "",
    software_company: initial?.software_company ?? "",
    purchase_date: initial?.purchase_date ?? "",
    is_own_credit_card: initial?.is_own_credit_card ?? true,
    original_currency: initial?.original_currency ?? "",
    original_amount: initial?.original_amount == null ? "" : String(initial.original_amount),
    declared_amount: initial?.declared_amount == null ? "" : String(initial.declared_amount),
  };
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function amountError(value: string): string | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "請輸入數字，不要加入貨幣符號或文字。";
  if (amount <= 0) return "金額必須大於 0。";
  if (amount > 1_000_000) return "金額不可超過 1,000,000。";
  return null;
}

function validate(form: FormState, required: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (form.id_number.trim() && !ID_PATTERN.test(form.id_number.trim())) errors.id_number = "身分證字號格式不正確。";
  if (form.birth_date.trim() && !validIsoDate(form.birth_date.trim())) errors.birth_date = "請使用 YYYY-MM-DD 的有效日期格式。";
  if (form.purchase_date.trim() && !validIsoDate(form.purchase_date.trim())) errors.purchase_date = "請使用 YYYY-MM-DD 的有效日期格式。";
  const originalAmountError = amountError(form.original_amount);
  const declaredAmountError = amountError(form.declared_amount);
  if (originalAmountError) errors.original_amount = originalAmountError;
  if (declaredAmountError) errors.declared_amount = declaredAmountError;
  if (form.applicant_type !== "normal" && !form.applicant_subtype.trim()) errors.applicant_subtype = "請選擇身分類別。";
  if (required) {
    for (const [key, label] of REQUIRED_FIELDS) {
      const value = form[key as keyof FormState];
      if (value == null || (typeof value === "string" && !value.trim())) errors[key as keyof FormState] = `請填寫「${label}」。`;
    }
  }
  return errors;
}

function Radio<T extends string | boolean>({ name, value, current, onChange, children }: { name: string; value: T; current: T | undefined; onChange: (value: T) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
      <input type="radio" name={name} className="accent-navy-700" checked={current === value} onChange={() => onChange(value)} />
      {children}
    </label>
  );
}

function Field({ id, label, hint, error, required = true, children }: { id: string; label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}{required ? <span className="text-red-700"> *</span> : null}</FieldLabel>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-[11px] font-medium text-red-700">{error}</p> : hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ApplicantForm({ publicId, initial, disabled, onDraftChange, onSaved }: {
  publicId: string;
  initial?: SourceApplicant | null;
  disabled?: boolean;
  onDraftChange: (draft: SourceIntakeDraftContext | null) => void;
  onSaved: (review: SourceReview) => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [baseline, setBaseline] = useState<FormState>(() => initialForm(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const fieldErrors = useMemo(() => validate(form, showRequired), [form, showRequired]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm((current) => ({ ...current, [key]: value })); setSaved(false); };
  const subtypes = form.applicant_type === "special" ? SPECIAL_SUBTYPES : form.applicant_type === "language" ? LANGUAGE_SUBTYPES : [];

  useEffect(() => {
    const fields: SourceIntakeDraftFields = {};
    for (const key of Object.keys(form) as Array<keyof FormState>) {
      if (form[key] !== baseline[key]) Object.assign(fields, { [key]: form[key] });
    }
    onDraftChange(Object.keys(fields).length ? { kind: "source_intake", fields } : null);
  }, [baseline, form, onDraftChange]);

  useEffect(() => () => onDraftChange(null), [onDraftChange]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setShowRequired(true);
    const errors = validate(form, true);
    const firstError = Object.values(errors)[0];
    if (firstError) return setError(firstError);
    setSaving(true);
    try {
      const payload: SourceApplicant = {
        phone: form.phone.trim(),
        birth_date: form.birth_date.trim(),
        household_address: form.household_address.trim(),
        mailing_address: form.mailing_address.trim(),
        applicant_type: form.applicant_type,
        applicant_subtype: form.applicant_subtype.trim() || null,
        payment_type: form.payment_type,
        software_category: form.software_category,
        applied_tool_name: form.applied_tool_name.trim(),
        software_company: form.software_company.trim(),
        purchase_date: form.purchase_date.trim(),
        is_own_credit_card: form.is_own_credit_card,
        original_currency: form.original_currency || null,
        original_amount: Number(form.original_amount),
        declared_amount: Number(form.declared_amount),
        ...(form.id_number.trim() ? { id_number: form.id_number.trim().toUpperCase() } : {}),
      };
      const review = await api.saveSourceData(publicId, payload);
      const next = { ...form, id_number: "" };
      setForm(next);
      setBaseline(next);
      setShowRequired(false);
      setSaved(true);
      onDraftChange(null);
      await onSaved(review);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="space-y-6" aria-label="申請人資料">
      <fieldset disabled={disabled || saving} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="id_number" label="身分證字號" required={false} error={fieldErrors.id_number} hint="僅用於確認同一人同時只能有一筆申請與文件比對；系統只保存遮罩與雜湊，不保存明碼。">
            <input id="id_number" aria-invalid={Boolean(fieldErrors.id_number)} aria-describedby={fieldErrors.id_number ? "id_number-error" : undefined} className={inputClassName} maxLength={12} placeholder="A123456789" autoComplete="off" value={form.id_number} onChange={(e) => set("id_number", e.target.value.toUpperCase())} />
          </Field>
          <Field id="phone" label="聯絡電話" error={fieldErrors.phone}><input id="phone" type="tel" className={inputClassName} maxLength={30} placeholder="0912345678" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field id="birth_date" label="出生日期" error={fieldErrors.birth_date} hint="格式 YYYY-MM-DD；須為 1985-04-03 至 2010-04-02（16~40 歲）"><input id="birth_date" type="text" inputMode="numeric" placeholder="2000-01-31" aria-invalid={Boolean(fieldErrors.birth_date)} aria-describedby={fieldErrors.birth_date ? "birth_date-error" : undefined} className={inputClassName} value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></Field>
          <div className="hidden sm:block" />
          <Field id="household_address" label="戶籍地址" error={fieldErrors.household_address}><input id="household_address" className={inputClassName} maxLength={300} value={form.household_address} onChange={(e) => set("household_address", e.target.value)} /></Field>
          <Field id="mailing_address" label="通訊地址" error={fieldErrors.mailing_address}><input id="mailing_address" className={inputClassName} maxLength={300} value={form.mailing_address} onChange={(e) => set("mailing_address", e.target.value)} /></Field>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-navy-900">購買明細（數位工具/軟體）</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="payment_type" label="繳費制度" hint="月費制買後 1 個月內、年費制買後 2 個月內須申請">
              <div className="flex gap-2" role="radiogroup" aria-label="繳費制度">
                <Radio name="payment_type" value={"annual" as PaymentType} current={form.payment_type} onChange={(v) => set("payment_type", v)}>年費制</Radio>
                <Radio name="payment_type" value={"monthly" as PaymentType} current={form.payment_type} onChange={(v) => set("payment_type", v)}>月費制</Radio>
              </div>
            </Field>
            <Field id="software_category" label="功能">
              <select id="software_category" className={inputClassName} value={form.software_category} onChange={(e) => set("software_category", e.target.value as SoftwareCategory)}>
                {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field id="applied_tool_name" label="軟體名稱" error={fieldErrors.applied_tool_name}><input id="applied_tool_name" className={inputClassName} maxLength={120} placeholder="例如：ChatGPT Plus、Canva Pro" value={form.applied_tool_name} onChange={(e) => set("applied_tool_name", e.target.value)} /></Field>
            <Field id="software_company" label="軟體公司名稱" error={fieldErrors.software_company}><input id="software_company" className={inputClassName} maxLength={120} placeholder="例如：OpenAI、Canva Inc." value={form.software_company} onChange={(e) => set("software_company", e.target.value)} /></Field>
            <Field id="purchase_date" label="購買日期" error={fieldErrors.purchase_date} hint="格式 YYYY-MM-DD；須介於 2026-04-02 至 2026-10-31"><input id="purchase_date" type="text" inputMode="numeric" placeholder="2026-04-02" aria-invalid={Boolean(fieldErrors.purchase_date)} aria-describedby={fieldErrors.purchase_date ? "purchase_date-error" : undefined} className={inputClassName} value={form.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
            <Field id="is_own_credit_card" label="是否本人信用卡">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="是否本人信用卡">
                <Radio name="own_card" value={true} current={form.is_own_credit_card} onChange={(v) => set("is_own_credit_card", v)}>本人信用卡</Radio>
                <Radio name="own_card" value={false} current={form.is_own_credit_card} onChange={(v) => set("is_own_credit_card", v)}>父母、配偶或法定代理人付費</Radio>
              </div>
            </Field>
            <Field id="original_currency" label="原始費用幣別" error={fieldErrors.original_currency}>
              <select id="original_currency" className={inputClassName} value={form.original_currency} onChange={(e) => set("original_currency", e.target.value as Currency | "")}>
                <option value="">請選擇</option>{CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="original_amount" label="原始費用" error={fieldErrors.original_amount}><input id="original_amount" type="text" inputMode="decimal" aria-invalid={Boolean(fieldErrors.original_amount)} aria-describedby={fieldErrors.original_amount ? "original_amount-error" : undefined} className={inputClassName} placeholder="19.99" value={form.original_amount} onChange={(e) => set("original_amount", e.target.value)} /></Field>
              <Field id="declared_amount" label="換算新臺幣" error={fieldErrors.declared_amount}><input id="declared_amount" type="text" inputMode="decimal" aria-invalid={Boolean(fieldErrors.declared_amount)} aria-describedby={fieldErrors.declared_amount ? "declared_amount-error" : undefined} className={inputClassName} placeholder="630" value={form.declared_amount} onChange={(e) => set("declared_amount", e.target.value)} /></Field>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-navy-900">申請身分</h3>
          <div className="space-y-2" role="radiogroup" aria-label="申請身分">
            {([["normal", "一般青年", "補助 50%，上限 NT$3,000"], ["special", "特定對象", "補助 90%，上限 NT$6,000，須附證明文件"], ["language", "文化語言保存者", "補助 90%，上限 NT$6,000，須附語言能力認證"]] as Array<[ApplicantType, string, string]>).map(([value, label, hint]) => (
              <div key={value}>
                <Radio name="applicant_type" value={value} current={form.applicant_type} onChange={(next) => { set("applicant_type", next); set("applicant_subtype", ""); }}>
                  <span><span className="font-semibold">{label}</span><span className="ml-2 text-xs text-slate-500">{hint}</span></span>
                </Radio>
                {form.applicant_type === value && subtypes.length ? (
                  <select aria-label={`${label}類別`} aria-invalid={Boolean(fieldErrors.applicant_subtype)} className={`${inputClassName} mt-2`} value={form.applicant_subtype} onChange={(e) => set("applicant_subtype", e.target.value)}>
                    <option value="">請選擇類別</option>{subtypes.map((item) => <option key={item}>{item}</option>)}
                  </select>
                ) : null}
              </div>
            ))}
            {fieldErrors.applicant_subtype ? <p role="alert" className="text-[11px] font-medium text-red-700">{fieldErrors.applicant_subtype}</p> : null}
          </div>
        </div>
      </fieldset>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <p role="status" className="text-sm font-semibold text-emerald-700">資料已儲存。</p> : null}
      <Button type="submit" loading={saving} disabled={disabled}><Save className="size-4" /> 儲存申請資料</Button>
    </form>
  );
}
