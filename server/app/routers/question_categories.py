"""题库分类管理路由"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.question_category import QuestionCategory
from app.models.question import Question
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["题库分类"])


class CategoryCreate(BaseModel):
    name: str
    parent_id: str | None = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    sort_order: int | None = None


def build_tree(categories: list[QuestionCategory], parent_id: str | None = None) -> list[dict]:
    """递归构建分类树"""
    children = [c for c in categories if c.parent_id == parent_id]
    children.sort(key=lambda c: c.sort_order)
    return [
        {
            "id": c.id,
            "name": c.name,
            "parent_id": c.parent_id,
            "sort_order": c.sort_order,
            "children": build_tree(categories, c.id),
        }
        for c in children
    ]


@router.get("/question-categories/tree")
def get_category_tree(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取分类树"""
    categories = db.query(QuestionCategory).order_by(QuestionCategory.sort_order).all()
    return build_tree(categories)


@router.get("/question-categories/flat")
def get_category_flat(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取扁平分类列表（用于下拉选择）"""
    categories = db.query(QuestionCategory).order_by(QuestionCategory.sort_order).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "parent_id": c.parent_id,
        }
        for c in categories
    ]


@router.post("/question-categories", status_code=201)
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """创建分类"""
    if data.parent_id:
        parent = db.query(QuestionCategory).filter(QuestionCategory.id == data.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="父分类不存在")

    category = QuestionCategory(
        id=str(uuid.uuid4()),
        name=data.name,
        parent_id=data.parent_id,
        sort_order=data.sort_order,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return {
        "id": category.id,
        "name": category.name,
        "parent_id": category.parent_id,
        "sort_order": category.sort_order,
    }


@router.put("/question-categories/{category_id}")
def update_category(
    category_id: str,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """更新分类"""
    category = db.query(QuestionCategory).filter(QuestionCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    if data.parent_id is not None:
        if data.parent_id == category_id:
            raise HTTPException(status_code=400, detail="不能将自己设为父分类")
        if data.parent_id:
            parent = db.query(QuestionCategory).filter(QuestionCategory.id == data.parent_id).first()
            if not parent:
                raise HTTPException(status_code=404, detail="父分类不存在")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return {
        "id": category.id,
        "name": category.name,
        "parent_id": category.parent_id,
        "sort_order": category.sort_order,
    }


@router.delete("/question-categories/{category_id}")
def delete_category(
    category_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """删除分类（递归删除子分类及关联题目）"""
    category = db.query(QuestionCategory).filter(QuestionCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    # 递归收集所有子节点 ID（含自身），深度优先
    def collect_descendant_ids(parent_id: str) -> list[str]:
        ids: list[str] = []
        children = db.query(QuestionCategory).filter(QuestionCategory.parent_id == parent_id).all()
        for child in children:
            ids.extend(collect_descendant_ids(child.id))
        ids.append(parent_id)  # 父节点放在最后，确保先删子节点
        return ids

    all_ids = collect_descendant_ids(category_id)

    # 删除关联题目
    db.query(Question).filter(Question.category_id.in_(all_ids)).delete(synchronize_session=False)
    db.flush()

    # 从深到浅删除分类（all_ids 已经是深度优先，叶子在前）
    for cid in all_ids:
        db.query(QuestionCategory).filter(QuestionCategory.id == cid).delete()
    db.commit()
    return {"ok": True}


@router.get("/question-categories/{category_id}/stats")
def get_category_stats(
    category_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取分类统计（递归统计所有子节点的题目数量）"""
    category = db.query(QuestionCategory).filter(QuestionCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    # 递归收集所有子节点 ID（含自身）
    def collect_descendant_ids(parent_id: str) -> list[str]:
        ids = [parent_id]
        children = db.query(QuestionCategory).filter(QuestionCategory.parent_id == parent_id).all()
        for child in children:
            ids.extend(collect_descendant_ids(child.id))
        return ids

    all_ids = collect_descendant_ids(category_id)

    # 统计各题型数量
    questions = db.query(Question).filter(Question.category_id.in_(all_ids)).all()

    type_counts = {
        "single_choice": 0,
        "multi_choice": 0,
        "true_false": 0,
        "fill_blank": 0,
        "essay": 0,
    }
    for q in questions:
        if q.type in type_counts:
            type_counts[q.type] += 1

    total = sum(type_counts.values())

    # 判断是否有子节点（是否叶子节点）
    child_count = db.query(QuestionCategory).filter(
        QuestionCategory.parent_id == category_id
    ).count()

    return {
        "id": category.id,
        "name": category.name,
        "is_leaf": child_count == 0,
        "child_count": child_count,
        **type_counts,
        "total_count": total,
        "created_at": category.created_at.isoformat() if category.created_at else None,
    }