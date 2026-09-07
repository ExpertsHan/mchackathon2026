"""Owner-checked OCR intake and private evidence retrieval."""

import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.auth import get_current_demo_user, require_application_owner
from app.core.database import get_db
from app.models import User
from app.schemas.source_review import DocumentType, SourceApplicantInput
from app.services.applications import get_application_by_public_id
from app.services.source_review import (
    analyze_sources,
    document_file,
    ensure_editable,
    review_payload,
    save_applicant,
    upload_document,
)

router = APIRouter(tags=["source-review"])


@router.post("/api/applications/{public_id}/source-data")
def update_source_data(
    public_id: str,
    payload: SourceApplicantInput,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
):
    application = get_application_by_public_id(db, public_id, for_update=True)
    require_application_owner(current_user, application)
    save_applicant(db, application, payload)
    db.commit()
    return review_payload(db, application, citizen=True)


@router.post("/api/applications/{public_id}/documents/{document_type}")
def upload_sources(
    public_id: str,
    document_type: DocumentType,
    files: list[UploadFile] = File(...),
    replace: bool = Query(default=False),
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
):
    application = get_application_by_public_id(db, public_id, for_update=True)
    require_application_owner(current_user, application)
    upload_document(db, application, document_type, files, replace=replace)
    db.commit()
    return review_payload(db, application, citizen=True)


@router.post("/api/applications/{public_id}/source-review")
def recheck_sources(
    public_id: str,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
):
    application = get_application_by_public_id(db, public_id, for_update=True)
    require_application_owner(current_user, application)
    ensure_editable(application)
    analyze_sources(db, application)
    db.commit()
    return review_payload(db, application, citizen=True)


@router.get("/api/applications/{public_id}/documents/{document_id}/file")
def citizen_file(
    public_id: str,
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
):
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    doc, path = document_file(db, application, document_id)
    return FileResponse(
        path,
        media_type=doc.content_type,
        filename=doc.original_filename,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/api/admin/applications/{public_id}/documents/{document_id}/file")
def reviewer_file(public_id: str, document_id: uuid.UUID, db: Session = Depends(get_db)):
    # Same demo-reviewer access model as the existing admin detail endpoint.
    application = get_application_by_public_id(db, public_id)
    doc, path = document_file(db, application, document_id)
    return FileResponse(
        path,
        media_type=doc.content_type,
        filename=doc.original_filename,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
