"""代办任务路由"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.task import Task
from app.routers.auth import get_current_user
from app.schemas.task import TaskCreate, TaskUpdate, TaskResponse

router = APIRouter(prefix="/api/student/tasks", tags=["代办任务"])
plan_router = APIRouter(prefix="/api/student", tags=["每日计划"])


@router.get("", response_model=list[TaskResponse])
def get_tasks(
    date: str = Query(..., description="日期，格式 YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取指定日期的任务列表"""
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.due_date == date,
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
    from sqlalchemy import or_, func

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
    assigned_course_ids: list[str] = []
    if current_user.role == "admin":
        assigned_course_ids = [
            c[0] for c in db.query(Course.id).filter(Course.status == "published").all()
        ]
    else:
        dept_id = None
        if current_user.department:
            dept = (
                db.query(Department)
                .filter(Department.name == current_user.department)
                .first()
            )
            if dept:
                dept_id = dept.id

        conditions = [CourseAssignment.user_id == current_user.id]
        if dept_id:
            conditions.append(CourseAssignment.department_id == dept_id)

        assignments = (
            db.query(CourseAssignment).filter(or_(*conditions)).all()
        )
        assigned_course_ids = list(set(a.course_id for a in assignments))

    active_courses = []
    if assigned_course_ids:
        course_rows = (
            db.query(Course)
            .filter(
                Course.id.in_(assigned_course_ids),
                Course.status == "published",
                Course.start_date.isnot(None),
                Course.end_date.isnot(None),
                Course.start_date <= today,
                Course.end_date >= today,
            )
            .order_by(Course.end_date.asc())
            .all()
        )

        # 过滤掉已完成（考试通过且进度满）的课程
        course_ids = [c.id for c in course_rows]
        progress_records = (
            db.query(LearningProgress)
            .filter(
                LearningProgress.user_id == current_user.id,
                LearningProgress.course_id.in_(course_ids),
            )
            .all()
        )
        progress_by_course: dict[str, list] = {}
        for pr in progress_records:
            progress_by_course.setdefault(pr.course_id, []).append(pr)

        video_counts = dict(
            db.query(Video.course_id, func.count(Video.id))
            .filter(Video.course_id.in_(course_ids))
            .group_by(Video.course_id)
            .all()
        )

        for c in course_rows:
            total = video_counts.get(c.id, 0)
            completed = sum(1 for p in progress_by_course.get(c.id, []) if p.completed)
            # 检查是否已完成（考试通过 + 进度满）
            if total > 0 and completed >= total:
                continue  # 已完成的课程不展示

            active_courses.append(
                {
                    "id": c.id,
                    "title": c.title,
                    "description": c.description,
                    "start_date": c.start_date.isoformat() if c.start_date else None,
                    "end_date": c.end_date.isoformat() if c.end_date else None,
                    "completed_count": completed,
                    "total_count": total,
                    "exam_passed": False,
                }
            )

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
    from app.models.course import Course, CourseAssignment
    from app.models.learning_progress import LearningProgress
    from app.models.department import Department
    from sqlalchemy import or_

    # 1. 个人任务
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.due_date == date,
        )
        .order_by(Task.sort_order, Task.created_at)
        .all()
    )

    # 2. 有效期内课程
    assigned_course_ids: list[str] = []
    if current_user.role == "admin":
        # 管理员切换学员视图时，展示所有已发布课程
        assigned_course_ids = [
            c[0] for c in db.query(Course.id).filter(Course.status == "published").all()
        ]
    else:
        dept_id = None
        if current_user.department:
            dept = db.query(Department).filter(Department.name == current_user.department).first()
            if dept:
                dept_id = dept.id

        conditions = [CourseAssignment.user_id == current_user.id]
        if dept_id:
            conditions.append(CourseAssignment.department_id == dept_id)

        assignments = (
            db.query(CourseAssignment)
            .filter(or_(*conditions))
            .all()
        )
        assigned_course_ids = list(set(a.course_id for a in assignments))

    courses = []
    if assigned_course_ids:
        course_rows = (
            db.query(Course)
            .filter(
                Course.id.in_(assigned_course_ids),
                Course.status == "published",
                Course.start_date.isnot(None),
                Course.end_date.isnot(None),
                Course.start_date <= date,
                Course.end_date >= date,
            )
            .all()
        )

        # 批量查询进度
        course_ids = [c.id for c in course_rows]
        progress_records = (
            db.query(LearningProgress)
            .filter(
                LearningProgress.user_id == current_user.id,
                LearningProgress.course_id.in_(course_ids),
            )
            .all()
        )
        progress_by_course: dict[str, list] = {}
        for pr in progress_records:
            progress_by_course.setdefault(pr.course_id, []).append(pr)

        # 批量查询视频总数作为进度分母
        from app.models.course import Video
        from sqlalchemy import func
        video_counts = dict(
            db.query(Video.course_id, func.count(Video.id))
            .filter(Video.course_id.in_(course_ids))
            .group_by(Video.course_id)
            .all()
        )

        courses = [
            {
                "id": c.id,
                "title": c.title,
                "description": c.description,
                "start_date": c.start_date.isoformat() if c.start_date else None,
                "end_date": c.end_date.isoformat() if c.end_date else None,
                "completed_count": sum(1 for p in progress_by_course.get(c.id, []) if p.completed),
                "total_count": video_counts.get(c.id, 0),
            }
            for c in course_rows
        ]

    return {
        "tasks": tasks,
        "courses": courses,
    }