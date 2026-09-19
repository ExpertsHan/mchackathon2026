"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Alert, Button, FieldLabel, inputClassName } from "@/components/ui";
import { CATEGORY_OPTIONS, CURRENCY_OPTIONS, LANGUAGE_SUBTYPES, SPECIAL_SUBTYPES } from "@/lib/constants";
import { api } from "@/lib/api";
import { REQUIRED_FIELDS } from "@/lib/intake";
import type { ApplicantType, Currency, PaymentType, SoftwareCategory, SourceApplicant, SourceReview } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

type FormState = SourceApplicant & { id_number: string };

const ID_PATTERN = /^[A-Za-z][0-9A-Da-d][0-9]{8}$/;

function Radio<T extends string | boolean>({ name, value, current, onChange, children }: { name: string; value: T; current: T | undefined; onChange: (value: T) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
      <input type="radio" name={name} className="accent-navy-700" checked={current === value} onChange={() => onChange(value)} />
      {children}
    </label>
  );
}

function Field({ id, label, hint, required = true, children }: { id: string; label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}{required ? <span className="text-red-700"> *</span> : null}</FieldLabel>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ApplicantForm({ publicId, initial, disabled, onSaved }: {
  publicId: string;
  initial?: SourceApplicant | null;
  disabled?: boolean;
  onSaved: (review: SourceReview) => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    applicant_type: "normal", payment_type: "monthly", software_category: "general", is_own_credit_card: true,
    ...initial, id_number: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm((current) => ({ ...current, [key]: value })); setSaved(false); };
  const text = (key: keyof SourceApplicant) => (form[key] as string | null | undefined) ?? "";
  const number = (key: keyof SourceApplicant, value: string) => set(key, (value === "" ? null : Number(value)) as never);
  const subtypes = form.applicant_type === "special" ? SPECIAL_SUBTYPES : form.applicant_type === "language" ? LANGUAGE_SUBTYPES : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const missing = REQUIRED_FIELDS.find(([key]) => !form[key]);
    if (missing) return setError(`請填寫「${missing[1]}」`);
    if (form.applicant_type !== "normal" && !form.applicant_subtype) return setError("請選擇身分類別");
    if (form.id_number && !ID_PATTERN.test(form.id_number.trim())) return setError("身分證字號格式不正確");
    setSaving(true);
    try {
      const { id_number, ...rest } = form;
      const review = await api.saveSourceData(publicId, { ...rest, ...(id_number.trim() ? { id_number: id_number.trim().toUpperCase() } : {}) });
      setForm((current) => ({ ...current, id_number: "" }));
      setSaved(true);
      await onSaved(review);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="space-y-6" aria-label="申請人資料">
      <fieldset disabled={disabled || saving} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="id_number" label="身分證字號" required={false} hint="僅用於確認「同一人同時只能有一筆申請」與文件比對，系統只保存遮罩與雜湊，不保存明碼。">
            <input id="id_number" className={inputClassName} maxLength={10} placeholder="A123456789" autoComplete="off" value={form.id_number} onChange={(e) => set("id_number", e.target.value.toUpperCase())} />
          </Field>
          <Field id="phone" label="聯絡電話"><input id="phone" type="tel" className={inputClassName} placeholder="0912345678" value={text("phone")} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field id="birth_date" label="出生日期" hint="須為民國 74 年 4 月 3 日至 99 年 4 月 2 日（16~40 歲）"><input id="birth_date" type="date" className={inputClassName} value={text("birth_date")} onChange={(e) => set("birth_date", e.target.value)} /></Field>
          <div className="hidden sm:block" />
          <Field id="household_address" label="戶籍地址"><input id="household_address" className={inputClassName} value={text("household_address")} onChange={(e) => set("household_address", e.target.value)} /></Field>
          <Field id="mailing_address" label="通訊地址"><input id="mailing_address" className={inputClassName} value={text("mailing_address")} onChange={(e) => set("mailing_address", e.target.value)} /></Field>
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
                {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field id="applied_tool_name" label="軟體名稱"><input id="applied_tool_name" className={inputClassName} placeholder="例如：ChatGPT Plus、Canva Pro" value={text("applied_tool_name")} onChange={(e) => set("applied_tool_name", e.target.value)} /></Field>
            <Field id="software_company" label="軟體公司名稱"><input id="software_company" className={inputClassName} placeholder="例如：OpenAI、Canva Inc." value={text("software_company")} onChange={(e) => set("software_company", e.target.value)} /></Field>
            <Field id="purchase_date" label="購買日期" hint="須介於民國 115 年 4 月 2 日至 10 月 31 日"><input id="purchase_date" type="date" className={inputClassName} value={text("purchase_date")} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
            <Field id="is_own_credit_card" label="是否本人信用卡">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="是否本人信用卡">
                <Radio name="own_card" value={true} current={form.is_own_credit_card} onChange={(v) => set("is_own_credit_card", v)}>本人信用卡</Radio>
                <Radio name="own_card" value={false} current={form.is_own_credit_card} onChange={(v) => set("is_own_credit_card", v)}>父母、配偶或法定代理人付費</Radio>
              </div>
            </Field>
            <Field id="original_currency" label="原始費用幣別">
              <select id="original_currency" className={inputClassName} value={form.original_currency ?? ""} onChange={(e) => set("original_currency", (e.target.value || null) as Currency | null)}>
                <option value="">請選擇</option>{CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="original_amount" label="原始費用"><input id="original_amount" type="number" min="0" step="0.01" className={inputClassName} placeholder="19.99" value={form.original_amount ?? ""} onChange={(e) => number("original_amount", e.target.value)} /></Field>
              <Field id="declared_amount" label="換算新臺幣"><input id="declared_amount" type="number" min="0" step="1" className={inputClassName} placeholder="630" value={form.declared_amount ?? ""} onChange={(e) => number("declared_amount", e.target.value)} /></Field>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-navy-900">申請身分</h3>
          <div className="space-y-2" role="radiogroup" aria-label="申請身分">
            {([["normal", "一般青年", "補助 50%，上限 NT$3,000"], ["special", "特定對象", "補助 90%，上限 NT$6,000，須附證明文件"], ["language", "文化語言保存者", "補助 90%，上限 NT$6,000，須附語言能力認證"]] as Array<[ApplicantType, string, string]>).map(([value, label, hint]) => (
              <div key={value}>
                <Radio name="applicant_type" value={value} current={form.applicant_type} onChange={(v) => { set("applicant_type", v); set("applicant_subtype", null); }}>
                  <span><span className="font-semibold">{label}</span><span className="ml-2 text-xs text-slate-500">{hint}</span></span>
                </Radio>
                {form.applicant_type === value && subtypes.length ? (
                  <select aria-label={`${label}類別`} className={`${inputClassName} mt-2`} value={form.applicant_subtype ?? ""} onChange={(e) => set("applicant_subtype", e.target.value || null)}>
                    <option value="">請選擇類別</option>{subtypes.map((item) => <option key={item}>{item}</option>)}
                  </select>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </fieldset>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <p role="status" className="text-sm font-semibold text-emerald-700">資料已儲存。</p> : null}
      <Button type="submit" loading={saving} disabled={disabled}><Save className="size-4" /> 儲存申請資料</Button>
    </form>
  );
}
