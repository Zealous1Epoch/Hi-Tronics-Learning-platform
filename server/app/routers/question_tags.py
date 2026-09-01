"""试题标签管理路由"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.question_tag import QuestionTag
from app.models.question import Question
from app.schemas.question_tag import TagCreate, TagUpdate, TagOut
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["试题标签"])


def build_tag_tree(tags: list[QuestionTag], parent_id: str | None = None) -> list[TagOut]:
    children = [t for t in tags if t.parent_id == parent_id]
    return [
        TagOut(
            id=t.id, name=t.name, parent_id=t.parent_id, sort_order=t.sort_order,
            children=build_tag_tree(tags, t.id),
        )
        for t in sorted(children, key=lambda x: x.sort_order)
    ]


def flatten_tags(tags: list[QuestionTag], parent_id: str | None = None, depth: int = 0) -> list[dict]:
    """展平标签树用于下拉选择"""
    result = []
    children = [t for t in tags if t.parent_id == parent_id]
    for t in sorted(children, key=lambda x: x.sort_order):
        prefix = "  " * depth
        result.append({"id": t.id, "name": prefix + t.name, "parent_id": t.parent_id})
        result.extend(flatten_tags(tags, t.id, depth + 1))
    return result


@router.get("/question-tags/tree", response_model=list[TagOut])
def list_tags_tree(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取标签树"""
    return build_tag_tree(db.query(QuestionTag).all())


@router.get("/question-tags/flat")
def list_tags_flat(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取展平的标签列表（用于下拉选择）"""
    return flatten_tags(db.query(QuestionTag).all())


@router.post("/question-tags", response_model=TagOut)
def create_tag(
    data: TagCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = QuestionTag(
        id=str(uuid.uuid4()),
        name=data.name,
        parent_id=data.parent_id,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagOut(id=tag.id, name=tag.name, parent_id=tag.parent_id, sort_order=tag.sort_order, children=[])


@router.put("/question-tags/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: str,
    data: TagUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = db.query(QuestionTag).filter(QuestionTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(tag, field, value)
    db.commit()
    db.refresh(tag)
    return TagOut(id=tag.id, name=tag.name, parent_id=tag.parent_id, sort_order=tag.sort_order, children=[])


@router.delete("/question-tags/{tag_id}")
def delete_tag(
    tag_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = db.query(QuestionTag).filter(QuestionTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    # 递归删除子标签
    def delete_children(parent_id: str):
        children = db.query(QuestionTag).filter(QuestionTag.parent_id == parent_id).all()
        for child in children:
            delete_children(child.id)
            db.delete(child)
    delete_children(tag_id)
    db.delete(tag)
    db.commit()
    return {"ok": True}