"""试卷管理路由"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.paper import Paper
from app.schemas.paper import (
    PaperCreate, PaperUpdate, PaperOut,
)
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["试卷管理"])


# ========== 试卷 CRUD ==========

@router.get("/papers", response_model=list[PaperOut])
def list_papers(
    category_id: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(Paper)
    if category_id:
        q = q.filter(Paper.category_id == category_id)
    if status:
        q = q.filter(Paper.status == status)
    return q.order_by(Paper.created_at.desc()).all()


@router.post("/papers", response_model=PaperOut, status_code=201)
def create_paper(
    data: PaperCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    paper = Paper(
        id=str(uuid.uuid4()),
        title=data.title,
        category_id=data.category_id,
        paper_type=data.paper_type,
        mandatory_questions=[mq.model_dump() for mq in data.mandatory_questions] if data.mandatory_questions else None,
        random_rules=[rr.model_dump() for rr in data.random_rules] if data.random_rules else None,
        source_banks=data.source_banks,
        total_score=data.total_score,
        created_by=current_user.id,
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)
    return paper


@router.get("/papers/{paper_id}", response_model=PaperOut)
def get_paper(
    paper_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在")
    return paper


@router.put("/papers/{paper_id}", response_model=PaperOut)
def update_paper(
    paper_id: str,
    data: PaperUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在")

    update_data = data.model_dump(exclude_unset=True)
    if "mandatory_questions" in update_data and update_data["mandatory_questions"] is not None:
        update_data["mandatory_questions"] = [mq.model_dump() for mq in data.mandatory_questions]
    if "random_rules" in update_data and update_data["random_rules"] is not None:
        update_data["random_rules"] = [rr.model_dump() for rr in data.random_rules]
    if "source_banks" in update_data:
        update_data["source_banks"] = data.source_banks

    for field, value in update_data.items():
        setattr(paper, field, value)
    db.commit()
    db.refresh(paper)
    return paper


@router.delete("/papers/{paper_id}")
def delete_paper(
    paper_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在")
    db.delete(paper)
    db.commit()
    return {"ok": True}