"""学习进度路由"""

import uuid
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer
from app.database import get_db
from app.models.user import User
from app.models.course import Course, CourseAssignment, Video
from app.models.exam import Exam, ExamResult
from app.models.learning_progress import LearningProgress
from app.models.department import Department
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
    """获取某课程的所有视频进度（含考试状态）"""
    records = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.course_id == course_id,
        )
        .all()
    )
    # 检查考试是否通过
    exam_passed = False
    course = db.query(Course).filter(Course.id == course_id).first()
    if course and course.exam_id:
        passed = (
            db.query(ExamResult)
            .filter(
                ExamResult.exam_id == course.exam_id,
                ExamResult.user_id == current_user.id,
                ExamResult.passed == True,
            )
            .first()
        )
        exam_passed = passed is not None
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
        "exam_passed": exam_passed,
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


@admin_router.get("/progress/overview")
def admin_progress_overview(
    department_id: str | None = Query(None),
    course_id: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理员查看所有学员的课程进度概览（含考试状态）"""
    # 部门过滤：递归收集子部门名称
    dept_names = None
    if department_id:
        dept = db.query(Department).filter(Department.id == department_id).first()
        if not dept:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

        def collect_names(d: Department) -> list[str]:
            names = [d.name]
            children = db.query(Department).filter(Department.parent_id == d.id).all()
            for child in children:
                names.extend(collect_names(child))
            return names

        dept_names = collect_names(dept)

    # 课程过滤
    courses_query = db.query(Course).filter(Course.status == "published")
    if course_id:
        courses_query = courses_query.filter(Course.id == course_id)
    courses = courses_query.all()

    # 获取每个课程的视频数
    course_video_counts: dict[str, int] = {}
    for c in courses:
        count = db.query(func.count(Video.id)).filter(Video.course_id == c.id).scalar() or 0
        if count > 0:
            course_video_counts[c.id] = count

    course_ids = list(course_video_counts.keys())
    if not course_ids:
        return []

    # 获取学员
    users_query = db.query(User).filter(User.role == "student", User.status == "active")
    if dept_names:
        users_query = users_query.filter(User.department.in_(dept_names))
    students = users_query.all()

    if not students:
        return []

    student_ids = [s.id for s in students]

    # 视频完成统计
    progress_rows = (
        db.query(
            LearningProgress.user_id,
            LearningProgress.course_id,
            func.count(LearningProgress.id).label("completed"),
        )
        .filter(
            LearningProgress.completed == True,
            LearningProgress.user_id.in_(student_ids),
            LearningProgress.course_id.in_(course_ids),
        )
        .group_by(LearningProgress.user_id, LearningProgress.course_id)
        .all()
    )

    user_video_progress: dict[str, dict[str, int]] = defaultdict(dict)
    for row in progress_rows:
        user_video_progress[row.user_id][row.course_id] = row.completed

    # 课程 -> 考试映射
    course_exam_map: dict[str, str] = {}
    for c in courses:
        if c.exam_id:
            course_exam_map[c.exam_id] = c.id

    # 考试结果统计（取最佳成绩）
    exam_results = (
        db.query(ExamResult)
        .filter(ExamResult.user_id.in_(student_ids))
        .all()
    )

    user_exam_info: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(dict))
    for r in exam_results:
        cid = course_exam_map.get(r.exam_id)
        if not cid:
            continue
        existing = user_exam_info[r.user_id].get(cid)
        if not existing or r.score > existing.get("best_score", 0):
            user_exam_info[r.user_id][cid] = {
                "passed": r.passed,
                "best_score": r.score,
                "attempts": (existing.get("attempts", 0) if existing else 0) + 1,
            }

    # 组装结果
    result = []
    for student in students:
        course_progress = []
        for cid, video_count in course_video_counts.items():
            c = next((co for co in courses if co.id == cid), None)
            if not c:
                continue
            completed = user_video_progress.get(student.id, {}).get(cid, 0)
            exam_info = user_exam_info.get(student.id, {}).get(cid, {})
            course_progress.append({
                "course_id": cid,
                "course_title": c.title,
                "video_completed": completed,
                "video_total": video_count,
                "exam_passed": exam_info.get("passed", False),
                "exam_best_score": exam_info.get("best_score"),
                "exam_attempts": exam_info.get("attempts", 0),
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


@admin_router.get("/progress/detail/{user_id}/{course_id}")
def admin_progress_detail(
    user_id: str,
    course_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理员查看某用户在某课程下的详细进度"""
    # 视频详情
    videos = (
        db.query(Video)
        .filter(Video.course_id == course_id)
        .order_by(Video.sort_order)
        .all()
    )

    progress_records = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == user_id,
            LearningProgress.course_id == course_id,
        )
        .all()
    )
    progress_map = {r.video_id: r for r in progress_records}

    video_details = []
    for v in videos:
        p = progress_map.get(v.id)
        video_details.append({
            "video_id": v.id,
            "title": v.title,
            "watched_seconds": p.watched_seconds if p else 0,
            "total_seconds": p.total_seconds if p else (v.duration or 0),
            "completed": p.completed if p else False,
        })

    # 考试记录
    course = db.query(Course).filter(Course.id == course_id).first()
    exam_details = []
    if course and course.exam_id:
        exam_records = (
            db.query(ExamResult)
            .filter(
                ExamResult.exam_id == course.exam_id,
                ExamResult.user_id == user_id,
            )
            .order_by(ExamResult.submitted_at.desc())
            .all()
        )
        exam = db.query(Exam).filter(Exam.id == course.exam_id).first()
        exam_details = [
            {
                "exam_id": r.exam_id,
                "exam_title": exam.title if exam else "未知考试",
                "score": r.score,
                "passed": r.passed,
                "attempt_number": r.attempt_number,
                "submitted_at": r.submitted_at.isoformat(),
            }
            for r in exam_records
        ]

    return {
        "videos": video_details,
        "exams": exam_details,
    }