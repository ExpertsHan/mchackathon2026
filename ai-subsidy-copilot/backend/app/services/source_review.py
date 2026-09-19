"""Document intake, OCR and the rule-engine evaluation of an application.

The OCR engine (RULE-001~020) is the authority for eligibility and the trial subsidy
amount. This module stores documents, drives the engine through ``ocr_bridge`` and
exposes the result. It never approves an application or moves money.
"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import ActorType, ApplicationStatus
from app.core.errors import DomainError, ResourceNotFound
from app.core.identity import hash_government_id
from app.models import Application, SourceDocument, SourceReview, User, utcnow
from app.schemas.source_review import SourceApplicantInput
from app.services.audit import record_audit
from app.services.ocr_bridge import OcrUnavailable, call_bridge, extract_document
from app.services.receipts import ReceiptError, extract_pdf_text, sha256_bytes, validate_upload

EDITABLE = {ApplicationStatus.DRAFT, ApplicationStatus.REQUESTED_INFORMATION}
# A person may have only one application in flight. Approved and paid cases are finished
# from the applicant's side, so they do not block a later application.
OPEN_STATUSES = {
    ApplicationStatus.DRAFT,
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.VERIFYING,
    ApplicationStatus.MANUAL_REVIEW,
    ApplicationStatus.REQUESTED_INFORMATION,
}
DUPLICATE_SCOPE_STATUSES = {
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.VERIFYING,
    ApplicationStatus.MANUAL_REVIEW,
    ApplicationStatus.REQUESTED_INFORMATION,
    ApplicationStatus.APPROVED,
    ApplicationStatus.PAYMENT_SCHEDULED,
    ApplicationStatus.PAID,
}
POLICY_NOTICE = (
    "資格與補助金額由 RULE-001~020 規則引擎判定；AI 不會自動核准，"
    "所有案件都須由承辦人員複核後才會進入撥款。"
)
DOCUMENT_LABELS = {
    "id_card": "身分證正反面照片",
    "receipt": "購買憑證/發票",
    "passbook": "存摺封面影本",
    "declaration": "切結書",
    "cultural_proof": "特定對象及文化語言保存者證明文件",
    "payer_declaration": "父母、配偶或法定代理人代為支付切結書",
}
# These types accumulate several images (both sides of an ID, invoice + statement).
MULTI_FILE_TYPES = {"id_card", "receipt"}
OCR_TYPES = ("receipt", "id_card", "passbook")
REQUIRED_APPLICANT_FIELDS = {
    "phone": "聯絡電話",
    "birth_date": "出生日期",
    "household_address": "戶籍地址",
    "mailing_address": "通訊地址",
    "applied_tool_name": "軟體名稱",
    "software_company": "軟體公司名稱",
    "purchase_date": "購買日期",
    "original_currency": "原始費用幣別",
    "original_amount": "原始費用",
    "declared_amount": "換算新臺幣",
}


def _today() -> date:
    return date.today()


def ensure_editable(application: Application) -> None:
    if application.status not in EDITABLE:
        raise DomainError(
            "APPLICATION_NOT_EDITABLE",
            "已送出的案件須由承辦人要求補件後才能修改。",
            status_code=409,
        )


def get_review(db: Session, application: Application) -> SourceReview:
    review = db.get(SourceReview, application.id)
    if review is None:
        review = SourceReview(
            application_id=application.id,
            applicant_data={},
            evaluation={},
            documents_required=False,
        )
        db.add(review)
        db.flush()
    return review


def documents_for(
    db: Session, application: Application, *, active_only: bool = True
) -> list[SourceDocument]:
    query = select(SourceDocument).where(SourceDocument.application_id == application.id)
    if active_only:
        query = query.where(SourceDocument.active.is_(True))
    return list(db.scalars(query.order_by(SourceDocument.created_at, SourceDocument.id)).all())


def required_document_types(applicant_data: dict) -> list[str]:
    """Documents the applicant must attach, given the declared identity and payer."""

    required = ["id_card", "receipt", "passbook", "declaration"]
    if applicant_data.get("applicant_type", "normal") != "normal":
        required.append("cultural_proof")
    if applicant_data.get("is_own_credit_card") is False:
        required.append("payer_declaration")
    return required


def _document_status_for_data(
    db: Session, application: Application, applicant_data: dict
) -> list[dict]:
    counts: dict[str, int] = {}
    for document in documents_for(db, application):
        counts[document.document_type] = counts.get(document.document_type, 0) + 1
    return [
        {
            "document_type": kind,
            "label": DOCUMENT_LABELS[kind],
            "multiple": kind in MULTI_FILE_TYPES,
            "uploaded_count": counts.get(kind, 0),
        }
        for kind in required_document_types(applicant_data)
    ]


def document_status(db: Session, application: Application) -> list[dict]:
    review = get_review(db, application)
    return _document_status_for_data(db, application, review.applicant_data)


def missing_documents(db: Session, application: Application) -> list[dict]:
    return [
        {"document_type": item["document_type"], "label": item["label"], "reason": "尚未上傳"}
        for item in document_status(db, application)
        if item["uploaded_count"] == 0
    ]


def progress_snapshot(db: Session, application: Application) -> dict:
    """Non-sensitive intake progress used by the assistant and tracking views."""

    # This helper is used by the read-only agent. Do not create an empty review merely
    # because the citizen opened chat before saving the form.
    review = db.get(SourceReview, application.id)
    data = review.applicant_data if review is not None else {}
    statuses = _document_status_for_data(db, application, data)
    applicant_missing = [
        label for key, label in REQUIRED_APPLICANT_FIELDS.items() if not data.get(key)
    ]
    if data.get("applicant_type", "normal") != "normal" and not data.get(
        "applicant_subtype"
    ):
        applicant_missing.append("身分類別")
    return {
        "tool": data.get("applied_tool_name"),
        "company": data.get("software_company"),
        "applicant_missing": applicant_missing,
        "receipt_uploaded": any(
            item["document_type"] == "receipt" and item["uploaded_count"] for item in statuses
        ),
        "missing_documents": [item["label"] for item in statuses if not item["uploaded_count"]],
        "evaluated": bool(review and review.evaluation.get("result")),
        "ai_result": review.evaluation.get("result") if review else None,
    }


def missing_applicant_fields(review: SourceReview) -> list[str]:
    data = review.applicant_data
    missing = [label for key, label in REQUIRED_APPLICANT_FIELDS.items() if not data.get(key)]
    if data.get("applicant_type", "normal") != "normal" and not data.get("applicant_subtype"):
        missing.append("身分類別")
    return missing


def _check_person_has_no_other_open_application(
    db: Session, application: Application, digest: str
) -> None:
    other = db.scalar(
        select(Application.public_id)
        .join(User, Application.user_id == User.id)
        .where(
            User.government_id_hash == digest,
            Application.id != application.id,
            Application.status.in_(OPEN_STATUSES),
        )
        .limit(1)
    )
    if other:
        raise DomainError(
            "ACTIVE_APPLICATION_EXISTS",
            "此身分證字號已有一筆申請案正在處理中，同一人同時間只能有一筆申請。",
            status_code=409,
        )


def save_applicant(db: Session, application: Application, payload: SourceApplicantInput) -> None:
    ensure_editable(application)
    user = application.user
    if payload.id_number:
        digest = hash_government_id(payload.id_number)
        if user.government_id_hash and user.government_id_hash != digest:
            raise DomainError(
                "ID_NUMBER_MISMATCH", "身分證字號與登入的申請人身分不符。", status_code=409
            )
        _check_person_has_no_other_open_application(db, application, digest)
        user.government_id_hash = digest
    review = get_review(db, application)
    review.applicant_data = payload.model_dump(mode="json", exclude={"id_number"})
    review.documents_required = True
    record_audit(
        db,
        "SOURCE_APPLICANT_UPDATED",
        ActorType.CITIZEN,
        str(application.user_id),
        application=application,
    )
    analyze_sources(db, application)


def upload_document(
    db: Session,
    application: Application,
    document_type: str,
    uploads: list,
    *,
    replace: bool = False,
) -> None:
    ensure_editable(application)
    if not uploads or len(uploads) > 5:
        raise DomainError("DOCUMENT_COUNT_LIMIT", "每次請上傳 1 至 5 個檔案。", status_code=400)
    # Bound retained history as well as current attachments.
    count = (
        db.scalar(
            select(func.count(SourceDocument.id)).where(
                SourceDocument.application_id == application.id
            )
        )
        or 0
    )
    if count + len(uploads) > settings.max_source_documents:
        raise DomainError("DOCUMENT_COUNT_LIMIT", "已達案件文件數量上限。", status_code=400)
    validated = []
    for upload in uploads:
        data = upload.file.read(settings.max_receipt_bytes + 1)
        try:
            name, mime = validate_upload(upload.filename or "document", upload.content_type, data)
            if Path(name).suffix.lower() == ".pdf":
                extract_pdf_text(data)  # Validate readability and page limit before any writes.
        except ReceiptError as exc:
            raise DomainError(exc.code, exc.message, status_code=400) from exc
        validated.append((name, mime, data))
    review = get_review(db, application)
    review.documents_required = True
    # Single-file types keep only the newest upload; earlier ones stay as inactive history.
    if replace or document_type not in MULTI_FILE_TYPES:
        for document in documents_for(db, application):
            if document.document_type == document_type:
                document.active = False
    root = settings.receipt_storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=len(validated)) as pool:
        results = list(
            pool.map(
                lambda item: extract_document(item[2], Path(item[0]).suffix.lower(), document_type),
                validated,
            )
        )
    written: list[Path] = []
    try:
        for (name, mime, data), result in zip(validated, results, strict=True):
            suffix = Path(name).suffix.lower()
            storage_name = f"{uuid.uuid4().hex}{suffix}"
            destination = root / storage_name
            destination.write_bytes(data)
            written.append(destination)
            document = SourceDocument(
                application_id=application.id,
                document_type=document_type,
                original_filename=name,
                storage_filename=storage_name,
                content_type=mime,
                size_bytes=len(data),
                sha256=sha256_bytes(data),
                ocr_status=result["status"],
                ocr_data=result["data"],
            )
            db.add(document)
            db.flush()
            record_audit(
                db,
                "SOURCE_DOCUMENT_UPLOADED",
                ActorType.CITIZEN,
                str(application.user_id),
                application=application,
                details={
                    "document_id": str(document.id),
                    "document_type": document_type,
                    "ocr_status": result["status"],
                },
            )
        analyze_sources(db, application)
    except Exception:
        for destination in written:
            destination.unlink(missing_ok=True)
        raise


def _duplicate_reference(
    db: Session, application: Application, documents: list[SourceDocument]
) -> str | None:
    """RULE-019 input: another active application using the same receipt evidence."""

    receipts = [doc for doc in documents if doc.document_type == "receipt"]
    if not receipts:
        return None
    others = db.execute(
        select(SourceDocument, Application.public_id)
        .join(Application, SourceDocument.application_id == Application.id)
        .where(
            Application.id != application.id,
            Application.status.in_(DUPLICATE_SCOPE_STATUSES),
            SourceDocument.document_type == "receipt",
            SourceDocument.active.is_(True),
        )
    ).all()
    for doc in receipts:
        data = doc.ocr_data
        for other, public_id in others:
            other_data = other.ocr_data
            if doc.sha256 == other.sha256:
                return public_id
            if (
                data.get("receipt_reference")
                and data.get("receipt_reference") == other_data.get("receipt_reference")
                and data.get("company_name") == other_data.get("company_name")
            ):
                return public_id
            features = ("company_name", "original_amount", "purchase_date")
            if all(data.get(key) and data.get(key) == other_data.get(key) for key in features):
                return public_id
    return None


def _id_number_cross_check(application: Application, documents: list[SourceDocument]) -> dict:
    registered = application.user.government_id_hash
    read = {
        doc.ocr_data.get("id_number_hash")
        for doc in documents
        if doc.document_type == "id_card" and doc.ocr_data.get("id_number_hash")
    }
    if registered and read:
        result = "MATCH" if registered in read else "MISMATCH"
    else:
        result = "UNKNOWN"
    return {
        "check": "id_number_vs_profile",
        "label": "申請登記身分證字號 vs 身分證 OCR 字號",
        "a_source": "applicant_profile",
        "a_value": application.user.government_id_masked,
        "b_source": "ocr:id_card.id_number",
        "b_value": next(
            (
                doc.ocr_data.get("id_number")
                for doc in documents
                if doc.document_type == "id_card" and doc.ocr_data.get("id_number")
            ),
            None,
        ),
        "result": result,
    }


def _engine_ocr_data(data: dict) -> dict:
    return {key: value for key, value in data.items() if key != "id_number_hash"}


def analyze_sources(db: Session, application: Application) -> dict:
    review = get_review(db, application)
    documents = documents_for(db, application)
    # Identity is from the authenticated profile; everything else is the applicant's
    # declaration and is cross-checked against the OCR evidence by the engine.
    applicant = {
        **review.applicant_data,
        "name": application.user.name,
        "email": application.user.email,
    }
    grouped = {
        kind: [
            {"ocr_status": doc.ocr_status, "ocr_data": _engine_ocr_data(doc.ocr_data)}
            for doc in documents
            if doc.document_type == kind
        ]
        for kind in OCR_TYPES
    }
    for kind in ("declaration", "cultural_proof", "payer_declaration"):
        grouped[f"{kind}_uploaded"] = any(doc.document_type == kind for doc in documents)
    try:
        evaluation = call_bridge(
            {
                "operation": "evaluate",
                "application": applicant,
                "documents": grouped,
                "context": {
                    "applicationDate": (
                        application.submitted_at.date() if application.submitted_at else _today()
                    ).isoformat(),
                    "duplicateApplicationId": _duplicate_reference(db, application, documents),
                },
            }
        )
        if evaluation.get("result") not in {
            "PASS",
            "REVIEW",
            "REJECT",
            "NEED_SUPPLEMENT",
            "FRAUD_RISK",
        } or not isinstance(evaluation.get("rules"), list):
            raise OcrUnavailable("OCR 分析回傳格式不正確，請重試或由承辦人確認。")
        if isinstance(evaluation.get("cross_validation"), list):
            evaluation["cross_validation"].append(_id_number_cross_check(application, documents))
    except OcrUnavailable as exc:
        evaluation = {
            "result": "REVIEW",
            "error": str(exc),
            "rules": [],
            "supplement_center": {"items": []},
        }
    evaluation.update(
        policy_notice=POLICY_NOTICE,
        evaluated_at=utcnow().isoformat(),
        documents_required=review.documents_required,
    )
    review.evaluation = evaluation
    review.updated_at = utcnow()
    record_audit(
        db,
        "SOURCE_REVIEW_COMPLETED",
        ActorType.RULE_ENGINE,
        "ocr-rules-v1",
        application=application,
        details={
            "result": evaluation["result"],
            "documents": len(documents),
            "rule_results": [
                {"id": rule["id"], "result": rule["disposition"]} for rule in evaluation["rules"]
            ],
        },
    )
    db.flush()
    return evaluation


def review_payload(db: Session, application: Application, *, citizen: bool) -> dict | None:
    review = db.get(SourceReview, application.id)
    if review is None:
        return None
    evaluation = review.evaluation
    supplement = evaluation.get("supplement_center", {})
    if citizen:
        # Raw extracted identity, email and bank fields stay in the reviewer view.
        subsidy = evaluation.get("subsidy") or {}
        evaluation = {
            key: evaluation.get(key)
            for key in ("result", "error", "policy_notice", "evaluated_at", "documents_required")
        }
        evaluation["subsidy"] = {
            key: subsidy.get(key)
            for key in (
                "applicant_category",
                "eligible_amount",
                "subsidy_rate",
                "subsidy_cap",
                "subsidy_amount",
                "unknown",
            )
        }
        evaluation["supplement_center"] = {
            "items": [
                {
                    "rule_id": item["rule_id"],
                    "missing_item": item["missing_item"],
                    "reason": f"請補充或確認：{item['missing_item']}",
                }
                for item in supplement.get("items", [])
            ],
            "deadline": supplement.get("deadline"),
        }
    documents = [
        {
            "id": str(doc.id),
            "document_type": doc.document_type,
            "filename": doc.original_filename,
            "content_type": doc.content_type,
            "size_bytes": doc.size_bytes,
            "ocr_status": doc.ocr_status,
            "active": doc.active,
            "created_at": doc.created_at.isoformat(),
            **(
                {
                    "ocr_data": {
                        key: value for key, value in doc.ocr_data.items() if key != "id_number_hash"
                    },
                    "sha256": doc.sha256,
                }
                if not citizen
                else {}
            ),
        }
        for doc in documents_for(db, application, active_only=False)
    ]
    return {
        "applicant_data": review.applicant_data,
        "evaluation": evaluation,
        "documents": documents,
        "required_documents": document_status(db, application),
        "missing_documents": missing_documents(db, application),
    }


def request_source_supplements(db: Session, application: Application) -> str | None:
    """Reopen a MANUAL_REVIEW case for documents the rule engine says are missing.

    Asking for documents is low risk and reversible, so it is the one action the engine
    takes without a human. Returns the message sent to the applicant, if any.
    """

    review = db.get(SourceReview, application.id)
    if (
        review is None
        or not review.documents_required
        or review.evaluation.get("result") != "NEED_SUPPLEMENT"
        or application.status != ApplicationStatus.MANUAL_REVIEW
    ):
        return None
    from app.services.state_machine import transition_application

    items = review.evaluation.get("supplement_center", {}).get("items", [])
    message = "請補充或確認：" + "、".join(item["missing_item"] for item in items)
    transition_application(application, ApplicationStatus.REQUESTED_INFORMATION)
    application.information_request = message
    record_audit(
        db,
        "MORE_INFORMATION_REQUESTED",
        ActorType.RULE_ENGINE,
        "ocr-rules-v1",
        application=application,
        details={"message": message, "source": "ocr", "reversible": True},
    )
    return message


def document_file(
    db: Session, application: Application, document_id: uuid.UUID
) -> tuple[SourceDocument, Path]:
    doc = db.get(SourceDocument, document_id)
    if doc is None or doc.application_id != application.id:
        raise ResourceNotFound("DOCUMENT_NOT_FOUND", "找不到這份文件。")
    root = settings.receipt_storage_dir.resolve()
    path = (root / doc.storage_filename).resolve()
    if path.parent != root or not path.is_file():
        raise ResourceNotFound("DOCUMENT_NOT_FOUND", "找不到這份文件。")
    return doc, path
