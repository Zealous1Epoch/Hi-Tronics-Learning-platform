"""学习进度路由"""

import uuid
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer, or_
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
    watched_seconds: int = Field(ge=0)
    total_seconds: int = Field(ge=0, default=0)


def _is_completed(watched: int, total: int) -> bool:
    """判断视频是否已看完（>= 90%）"""
    return total > 0 and watched >= total * 0.9


def _get_user_dept_id(user: User, db: Session) -> str | None:
    """根据用户 department 名称查找部门 ID"""
    if not user.department:
        return None
    dept = db.query(Department).filter(Department.name == user.department).first()
    return dept.id if dept else None


def _check_course_assignment(user_id: str, course_id: str, dept_id: str | None, db: Session) -> bool:
    """检查用户是否被分配了指定课程"""
    conditions = [CourseAssignment.user_id == user_id]
    if dept_id:
        conditions.append(CourseAssignment.department_id == dept_id)
    assignment = (
        db.query(CourseAssignment)
        .filter(CourseAssignment.course_id == course_id, or_(*conditions))
        .first()
    )
    return assignment is not None


@router.post("/progress")
def report_progress(
    data: ProgressReport,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """上报视频观看进度（upsert：每个用户+视频只保留一条记录）"""
    # 校验视频属于指定课程
    video = db.query(Video).filter(Video.id == data.video_id, Video.course_id == data.course_id).first()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="视频不属于该课程")

    # 校验学员已分配该课程
    dept_id = _get_user_dept_id(current_user, db)
    if not _check_course_assignment(current_user.id, data.course_id, dept_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="未分配该课程")

    existing = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.video_id == data.video_id,
            LearningProgress.course_id == data.course_id,
        )
        .first()
    )

    if existing:
        if data.total_seconds > 0:
            existing.total_seconds = data.total_seconds
        existing.watched_seconds = data.watched_seconds
        existing.completed = _is_completed(data.watched_seconds, existing.total_seconds)
        existing.last_accessed = datetime.now()
        # 同步 course_id（防止视频被移动到其他课程）
        if existing.course_id != data.course_id:
            existing.course_id = data.course_id
    else:
        progress = LearningProgress(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            course_id=data.course_id,
            video_id=data.video_id,
            watched_seconds=data.watched_seconds,
            total_seconds=data.total_seconds,
            completed=_is_completed(data.watched_seconds, data.total_seconds),
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
    # 校验学员已分配该课程
    dept_id = _get_user_dept_id(current_user, db)
    if not _check_course_assignment(current_user.id, course_id, dept_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="未分配该课程")

    # 获取课程实际视频数
    total_video_count = (
        db.query(func.count(Video.id))
        .filter(Video.course_id == course_id)
        .scalar()
    ) or 0

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
        "total_count": total_video_count,  # 使用课程实际视频数
        "exam_passed": exam_passed,
    }


@router.get("/courses-with-progress")
def get_courses_with_progress(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取已分配课程及每门课的进度（聚合接口，避免客户端 N+1）"""
    from app.models.course import CourseAssignment

    dept_id = _get_user_dept_id(current_user, db)
    conditions = [CourseAssignment.user_id == current_user.id]
    if dept_id:
        conditions.append(CourseAssignment.department_id == dept_id)

    assignments = (
        db.query(CourseAssignment)
        .filter(or_(*conditions))
        .all()
    )
    course_ids = list(set(a.course_id for a in assignments))
    if not course_ids:
        return []

    courses = (
        db.query(Course)
        .filter(Course.id.in_(course_ids), Course.status == "published")
        .order_by(Course.created_at.desc())
        .all()
    )

    # 批量获取视频数
    video_counts = dict(
        db.query(Video.course_id, func.count(Video.id))
        .filter(Video.course_id.in_(course_ids))
        .group_by(Video.course_id)
        .all()
    )

    # 批量获取进度
    progress_records = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.course_id.in_(course_ids),
        )
        .all()
    )
    progress_by_course: dict[str, list[LearningProgress]] = defaultdict(list)
    for pr in progress_records:
        progress_by_course[pr.course_id].append(pr)

    # 批量获取考试状态
    course_exam_map: dict[str, str] = {}
    for c in courses:
        if c.exam_id:
            course_exam_map[c.exam_id] = c.id
    exam_passed_map: dict[str, bool] = {}
    if course_exam_map:
        passed_exams = (
            db.query(ExamResult)
            .filter(
                ExamResult.user_id == current_user.id,
                ExamResult.exam_id.in_(course_exam_map.keys()),
                ExamResult.passed == True,
            )
            .all()
        )
        for pe in passed_exams:
            cid = course_exam_map.get(pe.exam_id)
            if cid:
                exam_passed_map[cid] = True

    result = []
    for c in courses:
        progress_list = progress_by_course.get(c.id, [])
        completed_count = sum(1 for p in progress_list if p.completed)
        total_videos = video_counts.get(c.id, 0)
        exam_passed = exam_passed_map.get(c.id, False)
        result.append({
            "id": c.id,
            "title": c.title,
            "description": c.description,
            "cover_image": c.cover_image,
            "video_count": total_videos,
            "status": c.status,
            "completed_count": completed_count,
            "total_count": total_videos,
            "exam_passed": exam_passed,
        })
    return result


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

    # 已完成课程数：需要对比每门课程的实际视频数
    completed_courses = 0
    course_progress = (
        db.query(
            LearningProgress.course_id,
            func.sum(LearningProgress.completed.cast(Integer)).label("done"),
        )
        .filter(LearningProgress.user_id == current_user.id)
        .group_by(LearningProgress.course_id)
        .all()
    )
    if course_progress:
        course_ids = [cp.course_id for cp in course_progress]
        # 批量查询课程实际视频数
        video_counts = dict(
            db.query(Video.course_id, func.count(Video.id))
            .filter(Video.course_id.in_(course_ids))
            .group_by(Video.course_id)
            .all()
        )
        completed_courses = sum(
            1 for cp in course_progress
            if cp.done >= video_counts.get(cp.course_id, 0) and video_counts.get(cp.course_id, 0) > 0
        )

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
    # 部门过滤：一次性加载所有部门，在内存中收集子部门名称
    dept_names = None
    if department_id:
        dept = db.query(Department).filter(Department.id == department_id).first()
        if not dept:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

        all_depts = db.query(Department).all()
        dept_map: dict[str, Department] = {d.id: d for d in all_depts}
        children_map: dict[str, list[Department]] = defaultdict(list)
        for d in all_depts:
            if d.parent_id:
                children_map[d.parent_id].append(d)

        def collect_names_in_memory(dept_id: str) -> list[str]:
            names: list[str] = [dept_map[dept_id].name]
            for child in children_map.get(dept_id, []):
                names.extend(collect_names_in_memory(child.id))
            return names

        dept_names = [dept.name] + collect_names_in_memory(department_id)

    # 课程过滤
    courses_query = db.query(Course).filter(Course.status == "published")
    if course_id:
        courses_query = courses_query.filter(Course.id == course_id)
    courses = courses_query.all()

    # 批量获取每个课程的视频数（避免 N+1）
    course_ids = [c.id for c in courses]
    video_counts_raw = (
        db.query(Video.course_id, func.count(Video.id))
        .filter(Video.course_id.in_(course_ids))
        .group_by(Video.course_id)
        .all()
    )
    course_video_counts: dict[str, int] = {
        cid: count for cid, count in video_counts_raw if count > 0
    }

    if not course_video_counts:
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
            LearningProgress.course_id.in_(course_video_counts.keys()),
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
        if existing:
            existing["attempts"] += 1
            if r.score > existing["best_score"]:
                existing["best_score"] = r.score
                existing["passed"] = r.passed
        else:
            user_exam_info[r.user_id][cid] = {
                "passed": r.passed,
                "best_score": r.score,
                "attempts": 1,
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
    # 校验用户存在
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

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