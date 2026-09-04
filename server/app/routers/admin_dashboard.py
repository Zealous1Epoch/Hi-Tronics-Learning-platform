"""管理后台首页数据接口"""

from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models.user import User
from app.models.course import Course, CourseAssignment
from app.models.exam import ExamResult
from app.models.learning_progress import LearningProgress
from app.routers.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["管理后台首页"])


class DashboardStats(BaseModel):
    total_students: int
    total_courses: int
    in_progress: int
    completed: int


class ActivityItem(BaseModel):
    time: str
    user_name: str
    action: str
    target: str
    type: str  # "course" | "exam"


@router.get("/dashboard-stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db), _=Depends(require_admin)):
    """获取首页统计卡片数据"""
    total_students = (
        db.query(func.count(User.id))
        .filter(User.role == "student", User.status == "active")
        .scalar()
        or 0
    )

    total_courses = (
        db.query(func.count(Course.id))
        .filter(Course.status == "published")
        .scalar()
        or 0
    )

    # 进行中：有学习进度记录的学员数
    in_progress = (
        db.query(func.count(func.distinct(LearningProgress.user_id)))
        .scalar()
        or 0
    )

    # 已完成：至少通过一次考试的学员数
    completed = (
        db.query(func.count(func.distinct(ExamResult.user_id)))
        .filter(ExamResult.passed == True)
        .scalar()
        or 0
    )

    return DashboardStats(
        total_students=total_students,
        total_courses=total_courses,
        in_progress=in_progress,
        completed=completed,
    )


@router.get("/recent-activities", response_model=list[ActivityItem])
def get_recent_activities(db: Session = Depends(get_db), _=Depends(require_admin)):
    """获取最近动态（最近 10 条）"""
    activities = []

    # 最近通过考试
    exam_results = (
        db.query(ExamResult, User)
        .join(User, ExamResult.user_id == User.id)
        .filter(ExamResult.passed == True)
        .order_by(ExamResult.submitted_at.desc())
        .limit(10)
        .all()
    )

    for er, user in exam_results:
        activities.append(
            ActivityItem(
                time=er.submitted_at.isoformat() if er.submitted_at else "",
                user_name=user.name,
                action="通过了考试",
                target=er.exam_id,  # 后面前端会映射
                type="exam",
            )
        )

    # 最近完成视频（学完一个视频章节）
    completions = (
        db.query(LearningProgress, User, Course)
        .join(User, LearningProgress.user_id == User.id)
        .join(Course, LearningProgress.course_id == Course.id)
        .filter(LearningProgress.completed == True)
        .order_by(LearningProgress.last_accessed.desc())
        .limit(10)
        .all()
    )

    for lp, user, course in completions:
        activities.append(
            ActivityItem(
                time=lp.last_accessed.isoformat() if lp.last_accessed else "",
                user_name=user.name,
                action="完成了视频",
                target=course.title,
                type="course",
            )
        )

    # 按时间降序排列，取前 10 条
    activities.sort(key=lambda a: a.time, reverse=True)
    return activities[:10]