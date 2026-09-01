"""学习进度路由"""

import uuid
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer
from app.database import get_db
from app.models.user import User
from app.models.course import Course, CourseAssignment, Video
from app.models.exam import ExamResult
from app.models.learning_progress import LearningProgress
from app.routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/student", tags=["学习进度"])
admin_router = APIRouter(prefix="/api/admin", tags=["管理后台进度"])


class ProgressReport(BaseModel):
    video_id: str
    course_id: str
    watched_seconds: int
    total_seconds: int = 0


@router.post("/progress")
def report_progress(
    data: ProgressReport,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """上报视频观看进度（upsert：每个用户+视频只保留一条记录）"""
    existing = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.video_id == data.video_id,
        )
        .first()
    )

    if existing:
        existing.watched_seconds = data.watched_seconds
        existing.total_seconds = data.total_seconds or existing.total_seconds
        existing.completed = (
            data.total_seconds > 0
            and data.watched_seconds >= data.total_seconds * 0.9
        )
        existing.last_accessed = datetime.now()
    else:
        progress = LearningProgress(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            course_id=data.course_id,
            video_id=data.video_id,
            watched_seconds=data.watched_seconds,
            total_seconds=data.total_seconds,
            completed=(
                data.total_seconds > 0
                and data.watched_seconds >= data.total_seconds * 0.9
            ),
        )
        db.add(progress)

    db.commit()
    return {"ok": True}


@router.get("/progress/{course_id}")
def get_course_progress(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取某课程的所有视频进度"""
    records = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.course_id == course_id,
        )
        .all()
    )
    return {
        "video_progress": {
            r.video_id: {
                "watched_seconds": r.watched_seconds,
                "total_seconds": r.total_seconds,
                "completed": r.completed,
            }
            for r in records
        },
        "completed_count": sum(1 for r in records if r.completed),
        "total_count": len(records),
    }


@router.get("/profile")
def get_student_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """学员个人学习档案"""
    # 已分配课程数
    assigned_count = (
        db.query(func.count(CourseAssignment.id))
        .filter(CourseAssignment.user_id == current_user.id)
        .scalar()
    ) or 0

    # 视频完成统计
    total_videos = (
        db.query(func.count(LearningProgress.id))
        .filter(LearningProgress.user_id == current_user.id)
        .scalar()
    ) or 0
    completed_videos = (
        db.query(func.count(LearningProgress.id))
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.completed == True,
        )
        .scalar()
    ) or 0
    total_watched = (
        db.query(func.sum(LearningProgress.watched_seconds))
        .filter(LearningProgress.user_id == current_user.id)
        .scalar()
    ) or 0

    # 已完成课程数（所有视频都完成的课程）
    completed_courses = 0
    course_progress = (
        db.query(
            LearningProgress.course_id,
            func.count(LearningProgress.id).label("total"),
            func.sum(LearningProgress.completed.cast(Integer)).label("done"),
        )
        .filter(LearningProgress.user_id == current_user.id)
        .group_by(LearningProgress.course_id)
        .all()
    )
    completed_courses = sum(1 for cp in course_progress if cp.total == cp.done and cp.total > 0)

    # 考试记录
    exam_results = (
        db.query(ExamResult)
        .filter(ExamResult.user_id == current_user.id)
        .order_by(ExamResult.submitted_at.desc())
        .limit(10)
        .all()
    )

    # 获取考试名称
    exam_ids = list(set(r.exam_id for r in exam_results))
    exams_map = {}
    if exam_ids:
        from app.models.exam import Exam
        exam_records = db.query(Exam).filter(Exam.id.in_(exam_ids)).all()
        exams_map = {e.id: e.title for e in exam_records}

    return {
        "assigned_courses": assigned_count,
        "completed_courses": completed_courses,
        "total_videos": total_videos,
        "completed_videos": completed_videos,
        "total_watched_seconds": total_watched,
        "exam_history": [
            {
                "exam_id": r.exam_id,
                "exam_title": exams_map.get(r.exam_id, "未知考试"),
                "score": r.score,
                "passed": r.passed,
                "attempt_number": r.attempt_number,
                "submitted_at": r.submitted_at.isoformat(),
            }
            for r in exam_results
        ],
    }


# ========== 管理员接口 ==========

@admin_router.get("/progress")
def admin_progress(
    course_id: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理员查看所有学员的学习进度"""
    # 一次性获取所有课程的视频数
    courses_query = db.query(
        Course.id,
        Course.title,
        func.count(Video.id).label("video_count"),
    ).outerjoin(Video, Video.course_id == Course.id).group_by(Course.id)
    if course_id:
        courses_query = courses_query.filter(Course.id == course_id)
    course_rows = courses_query.all()
    course_map = {
        r.id: {"title": r.title, "video_count": r.video_count}
        for r in course_rows if r.video_count > 0
    }

    if not course_map:
        return []

    # 一次性获取所有学员的完成数
    progress_rows = (
        db.query(
            LearningProgress.user_id,
            LearningProgress.course_id,
            func.count(LearningProgress.id).label("completed"),
        )
        .filter(
            LearningProgress.completed == True,
            LearningProgress.course_id.in_(course_map.keys()),
        )
        .group_by(LearningProgress.user_id, LearningProgress.course_id)
        .all()
    )

    # 按用户分组
    user_progress: dict[str, dict[str, int]] = defaultdict(dict)
    user_ids = set()
    for row in progress_rows:
        user_progress[row.user_id][row.course_id] = row.completed
        user_ids.add(row.user_id)

    if not user_ids:
        return []

    # 获取学员信息
    students = (
        db.query(User)
        .filter(User.id.in_(user_ids), User.role == "student")
        .all()
    )

    result = []
    for student in students:
        course_progress = []
        for cid, cinfo in course_map.items():
            completed = user_progress.get(student.id, {}).get(cid, 0)
            course_progress.append({
                "course_id": cid,
                "course_title": cinfo["title"],
                "completed_count": completed,
                "total_count": cinfo["video_count"],
                "progress_pct": round(completed / cinfo["video_count"] * 100),
            })
        if course_progress:
            result.append({
                "user_id": student.id,
                "user_name": student.name,
                "username": student.username,
                "department": student.department,
                "courses": course_progress,
            })

    return result