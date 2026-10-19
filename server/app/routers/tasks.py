"""代办任务路由"""

from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.task import Task
from app.routers.auth import get_current_user
from app.services.department_scope import get_assigned_course_ids
from app.services.progress_service import batch_progress_map
from app.schemas.task import TaskCreate, TaskUpdate, TaskResponse

router = APIRouter(prefix="/api/student/tasks", tags=["代办任务"])
plan_router = APIRouter(prefix="/api/student", tags=["每日计划"])


def _parse_date(value: str) -> date_type:
    """解析 YYYY-MM-DD。

    修复：原先直接把字符串交给 Date 类型的比较，格式错误时依赖数据库的隐式转换，
    行为不可预期。现在显式解析，格式不合法返回 400。
    """
    try:
        return date_type.fromisoformat(value.strip())
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="日期格式应为 YYYY-MM-DD",
        )


@router.get("", response_model=list[TaskResponse])
def get_tasks(
    date: str = Query(..., description="日期，格式 YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取指定日期的任务列表"""
    day = _parse_date(date)
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.due_date == day,
        )
        .order_by(Task.sort_order, Task.created_at)
        .all()
    )
    return tasks


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """创建任务"""
    import uuid

    task = Task(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=data.title,
        description=data.description,
        due_date=data.due_date,
        sort_order=data.sort_order,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: str,
    data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新任务（标题、描述、日期、完成状态、排序）"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    db.commit()
    db.refresh(task)
    return task


@router.get("/overview")
def get_tasks_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取所有未完成任务概览：已过期、即将到期、进行中课程"""
    from datetime import date, timedelta
    from app.models.course import Course, CourseAssignment, Video
    from app.models.learning_progress import LearningProgress
    from app.models.department import Department
    from app.models.exam import Exam, ExamResult
    from sqlalchemy import or_, and_, and_, func

    today = date.today()

    # 1. 已过期的个人任务（截止日期 < 今天）
    overdue_tasks = (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.due_date < today,
            Task.completed == False,
        )
        .order_by(Task.due_date.asc())
        .all()
    )

    # 2. 即将到期的个人任务（截止日期 >= 今天，且未完成）
    upcoming_tasks = (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.due_date >= today,
            Task.completed == False,
        )
        .order_by(Task.due_date.asc())
        .all()
    )

    # 3. 进行中课程
    # 修复：原先用 department 叶子名反查部门 ID（同名叶子部门会取错），
    # 且不含子部门；现统一走 department_scope。
    assigned_course_ids = get_assigned_course_ids(db, current_user)

    active_courses = []
    upcoming_expiry_courses = []
    if assigned_course_ids:
        course_rows = (
            db.query(Course)
            .filter(
                Course.id.in_(assigned_course_ids),
                Course.status == "published",
                or_(
                    # 没有设置时间范围的课程始终在代办中显示
                    and_(
                        Course.start_date.is_(None),
                        Course.end_date.is_(None),
                    ),
                    # 设置了时间范围的需在有效期内
                    and_(
                        Course.start_date.isnot(None),
                        Course.end_date.isnot(None),
                        Course.start_date <= today,
                        Course.end_date >= today,
                    ),
                ),
            )
            .order_by(Course.end_date.asc())
            .all()
        )

        # 统一进度口径：线上课程按视频节数、线下课程按签到场次数
        progress_map = batch_progress_map(db, current_user.id, course_rows)

        for c in course_rows:
            row = progress_map.get(c.id)
            if row is None or row.completed:
                continue  # 已完成的课程不出现在代办中

            course_dict = {
                "id": c.id,
                "title": c.title,
                # 历史字段保留（响应兼容）
                "course_type": c.course_type,
                "require_attendance": c.require_attendance,
                "unit_label": row.unit_label,
                "description": c.description,
                "start_date": c.start_date.isoformat() if c.start_date else None,
                "end_date": c.end_date.isoformat() if c.end_date else None,
                "completed_count": row.completed_count,
                "total_count": row.total_count,
                "exam_passed": row.exam_passed,
                "has_exam": row.has_exam,
                "can_take_exam": row.can_take_exam,
            }

            # 3天内到期 → 即将到期
            remaining_days = (c.end_date - today).days if c.end_date else 999
            if remaining_days <= 3:
                upcoming_expiry_courses.append(course_dict)
            else:
                active_courses.append(course_dict)

    # 构造返回数据
    def serialize_task(t: Task) -> dict:
        return {
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "completed": t.completed,
            "overdue_days": (today - t.due_date).days if t.due_date and t.due_date < today else 0,
            "remaining_days": (t.due_date - today).days if t.due_date and t.due_date >= today else 0,
        }

    return {
        "overdue_tasks": [serialize_task(t) for t in overdue_tasks],
        "upcoming_tasks": [serialize_task(t) for t in upcoming_tasks],
        "active_courses": active_courses,
        "upcoming_expiry_courses": upcoming_expiry_courses,
    }


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除任务"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")

    db.delete(task)
    db.commit()


# ── 每日计划（课程 + 任务） ──


@plan_router.get("/daily-plan")
def get_daily_plan(
    date: str = Query(..., description="日期，格式 YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取指定日期的计划：个人任务 + 有效期内课程"""
    from app.models.course import Course, CourseAssignment, CourseMaterial
    from app.models.learning_progress import LearningProgress
    from app.models.department import Department
    from app.models.exam import ExamResult
    from sqlalchemy import func, or_, and_

    day = _parse_date(date)

    # 1. 个人任务
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.due_date == day,
        )
        .order_by(Task.sort_order, Task.created_at)
        .all()
    )

    # 2. 有效期内课程
    # 修复：同 get_tasks_overview，统一走 department_scope（优先 department_id）。
    assigned_course_ids = get_assigned_course_ids(db, current_user)

    courses = []
    if assigned_course_ids:
        course_rows = (
            db.query(Course)
            .filter(
                Course.id.in_(assigned_course_ids),
                Course.status == "published",
                or_(
                    and_(
                        Course.start_date.is_(None),
                        Course.end_date.is_(None),
                    ),
                    and_(
                        Course.start_date.isnot(None),
                        Course.end_date.isnot(None),
                        Course.start_date <= day,
                        Course.end_date >= day,
                    ),
                ),
            )
            .all()
        )

        # 统一进度口径：线上课程按视频节数、线下课程按签到场次数
        progress_map = batch_progress_map(db, current_user.id, course_rows)

        # 课件数量：与视频平级的第一等课程内容，无视频课程也靠它构成学习内容
        material_counts = (
            dict(
                db.query(CourseMaterial.course_id, func.count(CourseMaterial.id))
                .filter(CourseMaterial.course_id.in_([c.id for c in course_rows]))
                .group_by(CourseMaterial.course_id)
                .all()
            )
            if course_rows
            else {}
        )

        courses = [
            {
                "id": c.id,
                "title": c.title,
                # 历史字段保留（响应兼容）
                "course_type": c.course_type,
                "require_attendance": c.require_attendance,
                "unit_label": row.unit_label,
                "description": c.description,
                "start_date": c.start_date.isoformat() if c.start_date else None,
                "end_date": c.end_date.isoformat() if c.end_date else None,
                "completed_count": row.completed_count,
                "total_count": row.total_count,
                "exam_passed": row.exam_passed,
                "has_exam": row.has_exam,
                "can_take_exam": row.can_take_exam,
                "material_count": material_counts.get(c.id, 0),
            }
            for c in course_rows
            for row in [progress_map.get(c.id)]
            if row is not None
        ]

    return {
        "tasks": tasks,
        "courses": courses,
    }