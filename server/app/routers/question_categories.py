"""题库分类管理路由"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.question_category import QuestionCategory
from app.models.question import Question
from app.models.course import Course
from app.models.paper import Paper
from app.routers.auth import get_current_user, require_admin
from app.services.log_service import write_log

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
    """递归构建分类树，子节点按创建时间升序（老的在上，新的在下）"""
    children = [c for c in categories if c.parent_id == parent_id]
    children.sort(key=lambda c: (c.sort_order, c.created_at or ""))
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
    _: User = Depends(get_current_user),
):
    """获取分类树（学生端课程分类展示使用）"""
    categories = db.query(QuestionCategory).order_by(QuestionCategory.sort_order).all()
    return build_tree(categories)


@router.get("/question-categories/flat")
def get_category_flat(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """获取扁平分类列表（学生端课程分类使用）"""
    categories = db.query(QuestionCategory).order_by(QuestionCategory.sort_order).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "parent_id": c.parent_id,
            "sort_order": c.sort_order,
        }
        for c in categories
    ]


@router.post("/question-categories", status_code=201)
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="question", action="create", resource_type="题库分类", resource_name=category.name if hasattr(category, 'name') else "", description=f"{current_user.name} 创建了题库分类「{category.name}」", level="info")
    return {
        "id": category.id,
        "name": category.name,
        "parent_id": category.parent_id,
        "sort_order": category.sort_order,
    }


class ReorderItem(BaseModel):
    id: str
    sort_order: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


@router.put("/question-categories/reorder")
def reorder_categories(
    data: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """批量更新分类排序（拖拽排序使用）"""
    for item in data.items:
        cat = db.query(QuestionCategory).filter(QuestionCategory.id == item.id).first()
        if cat:
            cat.sort_order = item.sort_order
    db.commit()
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="question", action="update", resource_type="题库分类", resource_name="", description=f"{current_user.name} 重排了题库分类顺序", level="info")
    return {"ok": True}


class ReorderBatchRequest(BaseModel):
    """前端拖拽排序后传回的完整兄弟节点顺序"""
    parent_id: str | None = None
    ordered_ids: list[str]


@router.put("/question-categories/reorder-batch")
def reorder_categories_batch(
    data: ReorderBatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """根据完整兄弟节点顺序重新分配 sort_order（拖拽排序使用）"""
    for index, cat_id in enumerate(data.ordered_ids):
        cat = db.query(QuestionCategory).filter(QuestionCategory.id == cat_id).first()
        if cat:
            cat.sort_order = index
    db.commit()
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="question", action="update", resource_type="题库分类", resource_name="", description=f"{current_user.name} 重排了题库分类顺序", level="info")
    return {"ok": True}


@router.put("/question-categories/{category_id}")
def update_category(
    category_id: str,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="question", action="update", resource_type="题库分类", resource_name=category.name if hasattr(category, 'name') else "", description=f"{current_user.name} 编辑了题库分类「{category.name}」", level="info")
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
    current_user: User = Depends(require_admin),
):
    """删除分类（递归删除子分类及关联题目，课程和试卷设为未分类）"""
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
    deleted_questions = db.query(Question).filter(Question.category_id.in_(all_ids)).delete(synchronize_session=False)

    # 关联课程设为未分类
    affected_courses = db.query(Course).filter(Course.category_id.in_(all_ids)).update(
        {"category_id": None}, synchronize_session=False
    )

    # 关联试卷设为未分类
    affected_papers = db.query(Paper).filter(Paper.category_id.in_(all_ids)).update(
        {"category_id": None}, synchronize_session=False
    )

    db.flush()

    # 从深到浅删除分类（all_ids 已经是深度优先，叶子在前）
    for cid in all_ids:
        db.query(QuestionCategory).filter(QuestionCategory.id == cid).delete()

    desc = f"{current_user.name} 删除了题库分类「{category.name}」"
    if affected_courses or affected_papers:
        desc += f"（{affected_courses} 门课程、{affected_papers} 张试卷已归为未分类）"
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="question", action="delete", resource_type="题库分类", resource_name=category.name if hasattr(category, 'name') else "", description=desc, level="warning")
    db.commit()
    return {
        "ok": True,
        "affected": {"questions": deleted_questions, "courses": affected_courses, "papers": affected_papers},
    }


@router.get("/question-categories/stats")
def get_all_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取全部试题的聚合统计"""
    questions = db.query(Question).all()

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

    return {
        "id": "",
        "name": "全部试题",
        "is_leaf": False,
        "child_count": 0,
        **type_counts,
        "total_count": total,
        "created_at": None,
    }


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


def _collect_descendant_ids(db: Session, category_id: str) -> list[str]:
    """递归收集分类及其所有子节点的 ID"""
    ids: list[str] = [category_id]
    children = db.query(QuestionCategory).filter(QuestionCategory.parent_id == category_id).all()
    for child in children:
        ids.extend(_collect_descendant_ids(db, child.id))
    return ids


class ImpactNode(BaseModel):
    name: str
    depth: int
    courses: int
    papers: int
    questions: int


class ImpactResponse(BaseModel):
    name: str
    child_count: int
    courses: int
    papers: int
    questions: int
    details: list[ImpactNode]


@router.get("/question-categories/{category_id}/impact")
def get_category_impact(
    category_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取删除分类前的影响范围统计"""
    category = db.query(QuestionCategory).filter(QuestionCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    all_ids = _collect_descendant_ids(db, category_id)

    # 统计各层级的课程、试卷、试题数量
    details: list[ImpactNode] = []
    total_courses = 0
    total_papers = 0
    total_questions = 0

    # BFS 遍历，计算每个节点的深度
    for cat_id in all_ids:
        cat = db.query(QuestionCategory).filter(QuestionCategory.id == cat_id).first()
        if not cat:
            continue
        # 计算深度
        depth = 0
        current = cat
        while current.parent_id:
            current = db.query(QuestionCategory).filter(QuestionCategory.id == current.parent_id).first()
            if current:
                depth += 1
            else:
                break
        # 收集该节点的子分类 ID（含自身），用于统计
        sub_ids = _collect_descendant_ids(db, cat.id)
        courses = db.query(Course).filter(Course.category_id.in_(sub_ids)).count()
        papers = db.query(Paper).filter(Paper.category_id.in_(sub_ids)).count()
        questions = db.query(Question).filter(Question.category_id.in_(sub_ids)).count()

        details.append(ImpactNode(
            name=cat.name, depth=depth,
            courses=courses, papers=papers, questions=questions,
        ))
        total_courses += courses
        total_papers += papers
        total_questions += questions

    # 去重：子分类的统计包含了父级，所以总数直接用 all_ids 统计
    total_courses = db.query(Course).filter(Course.category_id.in_(all_ids)).count()
    total_papers = db.query(Paper).filter(Paper.category_id.in_(all_ids)).count()
    total_questions = db.query(Question).filter(Question.category_id.in_(all_ids)).count()

    return ImpactResponse(
        name=category.name,
        child_count=len(all_ids) - 1,
        courses=total_courses,
        papers=total_papers,
        questions=total_questions,
        details=details,
    )