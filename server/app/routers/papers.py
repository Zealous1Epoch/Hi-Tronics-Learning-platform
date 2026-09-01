"""试卷管理路由"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.paper import PaperCategory, Paper
from app.schemas.paper import (
    PaperCategoryCreate, PaperCategoryUpdate, PaperCategoryOut,
    PaperCreate, PaperUpdate, PaperOut,
)
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["试卷管理"])


# ========== 试卷分类 ==========

def build_category_tree(categories: list[PaperCategory], parent_id: str | None = None) -> list[PaperCategoryOut]:
    children = [c for c in categories if c.parent_id == parent_id]
    return [
        PaperCategoryOut(
            id=c.id, name=c.name, parent_id=c.parent_id, sort_order=c.sort_order,
            children=build_category_tree(categories, c.id),
        )
        for c in sorted(children, key=lambda x: x.sort_order)
    ]


@router.get("/paper-categories/tree", response_model=list[PaperCategoryOut])
def list_paper_categories(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return build_category_tree(db.query(PaperCategory).all())


@router.post("/paper-categories", response_model=PaperCategoryOut)
def create_paper_category(
    data: PaperCategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cat = PaperCategory(name=data.name, parent_id=data.parent_id)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return PaperCategoryOut(id=cat.id, name=cat.name, parent_id=cat.parent_id, sort_order=cat.sort_order, children=[])


@router.put("/paper-categories/{cat_id}", response_model=PaperCategoryOut)
def update_paper_category(
    cat_id: str,
    data: PaperCategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cat = db.query(PaperCategory).filter(PaperCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    if data.name is not None:
        cat.name = data.name
    if data.parent_id is not None:
        cat.parent_id = data.parent_id
    db.commit()
    db.refresh(cat)
    return PaperCategoryOut(id=cat.id, name=cat.name, parent_id=cat.parent_id, sort_order=cat.sort_order, children=[])


@router.delete("/paper-categories/{cat_id}")
def delete_paper_category(
    cat_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cat = db.query(PaperCategory).filter(PaperCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    # 删除子分类
    db.query(PaperCategory).filter(PaperCategory.parent_id == cat_id).delete()
    db.delete(cat)
    db.commit()
    return {"ok": True}


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
    # 处理 JSON 字段
    if "mandatory_questions" in update_data and update_data["mandatory_questions"] is not None:
        update_data["mandatory_questions"] = [mq.model_dump() for mq in data.mandatory_questions]
    if "random_rules" in update_data and update_data["random_rules"] is not None:
        update_data["random_rules"] = [rr.model_dump() for rr in data.random_rules]

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