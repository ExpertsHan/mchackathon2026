"""OCR intake, source comparison and human-review recommendations.

OCR policy calculations are advisory. Copilot remains the authority for eligibility
and mock payment amounts. Opting into document intake requires human verification.
"""

from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import ActorType, ApplicationStatus, EligibilityOutcome, RiskLevel
from app.core.errors import DomainError, ResourceNotFound
from app.models import Application, SourceDocument, SourceReview, Subscription, utcnow
from app.schemas.source_review import SourceApplicantInput
from app.services.audit import record_audit
from app.services.ocr_bridge import OcrUnavailable, call_bridge, extract_document
from app.services.receipts import ReceiptError, extract_pdf_text, sha256_bytes, validate_upload

EDITABLE = {ApplicationStatus.DRAFT, ApplicationStatus.REQUESTED_INFORMATION}
POLICY_NOTICE = "OCR 的年齡、受理期間與補助試算供複核參考；核定資格及撥款金額依 Copilot 示範政策。"


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


def save_applicant(db: Session, application: Application, payload: SourceApplicantInput) -> None:
    ensure_editable(application)
    review = get_review(db, application)
    review.applicant_data = payload.model_dump(mode="json")
    review.documents_required = True
    record_audit(
        db,
        "SOURCE_APPLICANT_UPDATED",
        ActorType.CITIZEN,
        str(application.user_id),
        application=application,
    )
    analyze_sources(db, application)


def record_receipt(db: Session, application: Application, stored) -> None:
    # The primary receipt endpoint replaces the prior primary receipt, preserving history.
    for document in documents_for(db, application):
        if document.document_type == "receipt":
            document.active = False
    extracted = stored.extraction
    fields = dict(extracted.source_fields)
    mappings = {
        "company_name": extracted.provider,
        "product_name": extracted.product,
        "original_amount": float(extracted.amount) if extracted.amount is not None else None,
        "currency": extracted.currency,
        "purchase_date": extracted.purchase_date.isoformat() if extracted.purchase_date else None,
        "buyer_email": extracted.account_email,
        "receipt_reference": extracted.receipt_reference,
    }
    for key, value in mappings.items():
        if value is not None and key not in fields:
            fields[key] = value
    # Only literal TWD amounts belong to OCR evidence; mock FX is a different source.
    if extracted.currency == "TWD" and extracted.amount is not None:
        fields.setdefault("converted_twd_amount", float(extracted.amount))
    fields["_confidence"] = extracted.field_confidence or {
        key: extracted.confidence for key in fields
    }
    db.add(
        SourceDocument(
            application_id=application.id,
            document_type="receipt",
            original_filename=stored.original_filename,
            storage_filename=stored.storage_filename,
            content_type=stored.content_type,
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            ocr_status="done" if mappings["product_name"] else "skipped",
            ocr_data=fields,
        )
    )
    db.flush()
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
    if replace:
        for document in documents_for(db, application):
            if document.document_type == document_type:
                document.active = False
    root = settings.receipt_storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    try:
        for name, mime, data in validated:
            suffix = Path(name).suffix.lower()
            result = extract_document(data, suffix, document_type)
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
    active_statuses = {
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.VERIFYING,
        ApplicationStatus.MANUAL_REVIEW,
        ApplicationStatus.APPROVED,
        ApplicationStatus.PAYMENT_SCHEDULED,
        ApplicationStatus.PAID,
    }
    receipts = [doc for doc in documents if doc.document_type == "receipt"]
    hashes = [doc.sha256 for doc in receipts]
    if hashes:
        other = db.scalar(
            select(Application.public_id)
            .join(Subscription, Application.subscription_id == Subscription.id)
            .where(
                Application.id != application.id,
                Application.status.in_(active_statuses),
                Subscription.receipt_hash.in_(hashes),
            )
            .limit(1)
        )
        if other:
            return other
    other_receipts = db.execute(
        select(SourceDocument, Application.public_id)
        .join(Application, SourceDocument.application_id == Application.id)
        .where(
            Application.id != application.id,
            Application.status.in_(active_statuses),
            SourceDocument.document_type == "receipt",
            SourceDocument.active.is_(True),
        )
    ).all()
    for doc in receipts:
        for other, public_id in other_receipts:
            if doc.sha256 == other.sha256:
                return public_id
            reference = doc.ocr_data.get("receipt_reference")
            if (
                reference
                and reference == other.ocr_data.get("receipt_reference")
                and doc.ocr_data.get("company_name") == other.ocr_data.get("company_name")
            ):
                return public_id
    return None


def analyze_sources(db: Session, application: Application) -> dict:
    review = get_review(db, application)
    documents = documents_for(db, application)
    # Identity is from the authenticated profile; birth date remains an explicit declaration.
    applicant = {
        **review.applicant_data,
        "name": application.user.name,
        "email": application.user.email,
    }
    grouped = {
        kind: [
            {"ocr_status": doc.ocr_status, "ocr_data": doc.ocr_data}
            for doc in documents
            if doc.document_type == kind
        ]
        for kind in ("receipt", "id_card", "passbook")
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
                        application.submitted_at.date()
                        if application.submitted_at
                        else date.today()
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


def apply_review_gate(db: Session, application: Application, result, *, refresh: bool):
    review = db.get(SourceReview, application.id)
    if review is None:
        return result
    evaluation = analyze_sources(db, application) if refresh else review.evaluation
    # Receipt-only intake retains Copilot's existing policy. Actual evidence conflicts
    # and failures still require review; OCR-specific missing ID/bank/declaration rules
    # become applicable when the applicant starts the complete document workflow.
    flags = [
        rule
        for rule in evaluation.get("rules", [])
        if rule.get("id") in {"RULE-006", "RULE-007", "RULE-008", "RULE-019"}
        and rule.get("result") in {"REJECT", "FRAUD_RISK"}
    ]
    if not (review.documents_required or flags or evaluation.get("error")):
        return result
    reason = (
        "OCR 文件審核須由承辦人確認。"
        if review.documents_required
        else "OCR 來源分析有待確認項目。"
    )
    high = result.risk_level == RiskLevel.HIGH or any(
        flag.get("result") == "FRAUD_RISK" for flag in flags
    )
    return result.model_copy(
        update={
            "eligible": False,
            "provisionally_eligible": False,
            "requires_manual_review": True,
            "outcome": EligibilityOutcome.MANUAL_REVIEW,
            "approved_amount_twd": result.approved_amount_twd * 0,
            "risk_level": RiskLevel.HIGH if high else RiskLevel.MEDIUM,
            "risk_reasons": [*result.risk_reasons, reason],
        }
    )


def review_payload(db: Session, application: Application, *, citizen: bool) -> dict | None:
    review = db.get(SourceReview, application.id)
    if review is None:
        return None
    evaluation = review.evaluation
    if citizen:
        # Raw extracted identity, email and bank fields stay in the reviewer view.
        evaluation = {
            key: evaluation.get(key)
            for key in ("result", "error", "policy_notice", "evaluated_at", "documents_required")
        }
        evaluation["supplement_center"] = {
            "items": [
                {
                    "rule_id": item["rule_id"],
                    "missing_item": item["missing_item"],
                    "reason": f"請補充或確認：{item['missing_item']}",
                }
                for item in review.evaluation.get("supplement_center", {}).get("items", [])
            ],
            "deadline": review.evaluation.get("supplement_center", {}).get("deadline"),
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
            **({"ocr_data": doc.ocr_data, "sha256": doc.sha256} if not citizen else {}),
        }
        for doc in documents_for(db, application, active_only=False)
    ]
    return {
        "applicant_data": review.applicant_data,
        "evaluation": evaluation,
        "documents": documents,
    }


def request_source_supplements(db: Session, application: Application) -> None:
    review = db.get(SourceReview, application.id)
    if (
        review is None
        or not review.documents_required
        or review.evaluation.get("result") != "NEED_SUPPLEMENT"
        or application.status != ApplicationStatus.MANUAL_REVIEW
    ):
        return
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
