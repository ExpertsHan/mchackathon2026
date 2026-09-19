"""Ephemeral validation for unsaved citizen-side form drafts."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, Field

from app.core.identity import is_valid_government_id
from app.schemas.api import SourceIntakeDraftContext

DraftFieldState = Literal["empty", "valid", "invalid"]

_DATE_FIELDS = {"birth_date", "purchase_date"}
_AMOUNT_FIELDS = {"original_amount", "declared_amount"}
_CHOICES = {
    "applicant_type": {"normal", "special", "language"},
    "payment_type": {"monthly", "annual"},
    "software_category": {"general", "image", "office", "learning", "other"},
    "original_currency": {"TWD", "USD", "JPY", "EUR", "AUD", "HKD", "other"},
}
_FIELD_LABELS = {
    "id_number": "身分證字號",
    "phone": "聯絡電話",
    "birth_date": "出生日期",
    "household_address": "戶籍地址",
    "mailing_address": "通訊地址",
    "applicant_type": "申請身分",
    "applicant_subtype": "身分類別",
    "payment_type": "繳費制度",
    "software_category": "工具分類",
    "applied_tool_name": "軟體名稱",
    "software_company": "軟體公司名稱",
    "purchase_date": "申報購買日期",
    "is_own_credit_card": "是否使用本人信用卡",
    "original_currency": "原始費用幣別",
    "original_amount": "原始費用",
    "declared_amount": "申報購買金額",
}
_GUIDANCE = {
    "invalid_id_number": "請輸入有效的身分證字號。系統不會把明碼交給模型。",
    "invalid_date": "請使用 YYYY-MM-DD 的有效日期格式。",
    "not_numeric": "請輸入數字，不要加入貨幣符號或文字。",
    "must_be_positive": "金額必須大於 0。",
    "above_maximum": "金額不可超過新臺幣 1,000,000 元。",
    "unsupported_choice": "請從表單提供的選項中選擇。",
}
_GUIDANCE_EN = {
    "invalid_id_number": "Enter a valid government ID. The raw value is never sent to the model.",
    "invalid_date": "Enter a valid date in YYYY-MM-DD format.",
    "not_numeric": "Enter a number without currency symbols or words.",
    "must_be_positive": "The amount must be greater than 0.",
    "above_maximum": "The amount cannot exceed TWD 1,000,000.",
    "unsupported_choice": "Choose one of the options provided by the form.",
}
_FIELD_LABELS_EN = {
    "id_number": "Government ID",
    "phone": "Phone number",
    "birth_date": "Birth date",
    "household_address": "Household address",
    "mailing_address": "Mailing address",
    "applicant_type": "Applicant type",
    "applicant_subtype": "Applicant subtype",
    "payment_type": "Payment plan",
    "software_category": "Tool category",
    "applied_tool_name": "Software name",
    "software_company": "Software company",
    "purchase_date": "Declared purchase date",
    "is_own_credit_card": "Own credit card",
    "original_currency": "Original currency",
    "original_amount": "Original amount",
    "declared_amount": "Declared purchase amount",
}


class DraftFieldSummary(BaseModel):
    status: DraftFieldState
    issues: list[str] = Field(default_factory=list)
    guidance: list[str] = Field(default_factory=list)


class DraftValidationSummary(BaseModel):
    kind: Literal["source_intake"] = "source_intake"
    unsaved: Literal[True] = True
    authoritative: Literal[False] = False
    dirty_fields: list[str] = Field(default_factory=list)
    fields: dict[str, DraftFieldSummary] = Field(default_factory=dict)

    @property
    def has_issues(self) -> bool:
        return any(field.status == "invalid" for field in self.fields.values())


def _summary(status: DraftFieldState, *issues: str) -> DraftFieldSummary:
    return DraftFieldSummary(
        status=status,
        issues=list(issues),
        guidance=[_GUIDANCE[issue] for issue in issues],
    )


def _validate_date(value: str | None) -> DraftFieldSummary:
    text = (value or "").strip()
    if not text:
        return _summary("empty")
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            raise ValueError
        date.fromisoformat(text)
    except ValueError:
        return _summary("invalid", "invalid_date")
    return _summary("valid")


def _validate_amount(value: str | None) -> DraftFieldSummary:
    text = (value or "").strip()
    if not text:
        return _summary("empty")
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return _summary("invalid", "not_numeric")
    if not amount.is_finite():
        return _summary("invalid", "not_numeric")
    if amount <= 0:
        return _summary("invalid", "must_be_positive")
    if amount > 1_000_000:
        return _summary("invalid", "above_maximum")
    return _summary("valid")


def summarize_draft(
    draft: SourceIntakeDraftContext | None,
) -> DraftValidationSummary | None:
    """Return a model-safe summary without copying any raw field values."""

    if draft is None:
        return None
    fields: dict[str, DraftFieldSummary] = {}
    dirty_fields = sorted(draft.fields.model_fields_set)
    for name in dirty_fields:
        value = getattr(draft.fields, name)
        if name == "id_number":
            text = (value or "").strip()
            if not text:
                fields[name] = _summary("empty")
            elif not is_valid_government_id(text):
                fields[name] = _summary("invalid", "invalid_id_number")
            else:
                fields[name] = _summary("valid")
        elif name in _DATE_FIELDS:
            fields[name] = _validate_date(value)
        elif name in _AMOUNT_FIELDS:
            fields[name] = _validate_amount(value)
        elif name in _CHOICES:
            text = (value or "").strip()
            if not text:
                fields[name] = _summary("empty")
            elif text not in _CHOICES[name]:
                fields[name] = _summary("invalid", "unsupported_choice")
            else:
                fields[name] = _summary("valid")
        elif isinstance(value, str):
            fields[name] = _summary("valid" if (value or "").strip() else "empty")
        else:
            fields[name] = _summary("valid")
    return DraftValidationSummary(dirty_fields=dirty_fields, fields=fields)


def deterministic_draft_guidance(
    summary: DraftValidationSummary | None, *, chinese: bool
) -> str | None:
    if summary is None:
        return None
    invalid = [
        (name, field)
        for name, field in summary.fields.items()
        if field.status == "invalid"
    ]
    if not invalid:
        return (
            "目前尚未儲存的欄位沒有格式錯誤；請先儲存表單，再依頁面提示完成文件。"
            if chinese
            else "The unsaved fields have no format errors. Save the form, then follow the page "
            "for any remaining documents."
        )
    parts = []
    for name, field in invalid:
        label = _FIELD_LABELS[name] if chinese else _FIELD_LABELS_EN[name]
        guidance = (
            " ".join(field.guidance)
            if chinese
            else " ".join(_GUIDANCE_EN[issue] for issue in field.issues)
        )
        parts.append(f"{label}：{guidance}" if chinese else f"{label}: {guidance}")
    prefix = "目前無法儲存是因為：" if chinese else "The unsaved form has these problems: "
    return prefix + ("；" if chinese else " ").join(parts)
