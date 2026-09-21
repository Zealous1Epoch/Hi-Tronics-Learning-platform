"""学习进度路由"""

import uuid
import io
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, Integer, or_
from app.database import get_db
from app.models.user import User
from app.models.attendance import AttendanceRecord
from app.models.course import Course, CourseAssignment, Video
from app.models.exam import Exam, ExamResult
from app.models.learning_progress import LearningProgress
from app.models.department import Department
from app.routers.auth import get_current_user, require_admin
from app.services.department_scope import (
    check_course_assignment,
    get_assigned_course_ids,
    get_department_scope_ids,
)
from app.services.attendance_service import (
    EFFECTIVE_STATUSES,
    load_sessions,
    session_state,
    attendance_blockers,
    batch_offline_counts,
    course_attendance_detail,
    session_ids_by_course,
)
from app.services.progress_service import batch_progress_map, completed_course_count
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(prefix="/api/student", tags=["学习进度"])
admin_router = APIRouter(prefix="/api/admin", tags=["管理后台进度"])


class ProgressReport(BaseModel):
    video_id: str
    course_id: str
    watched_seconds: int = Field(ge=0)
    total_seconds: int = Field(ge=0, default=0)


def _is_completed(watched: int, total: int) -> bool:
    """判断视频是否已看完（>= 95% 即算完成，容忍播放器进度事件误差）"""
    return total > 0 and watched >= total * 0.95


def _assigned_courses(db: Session, user: User) -> list[Course]:
    """学员可见的课程对象列表（管理员返回全部已发布课程）。"""
    course_ids = get_assigned_course_ids(db, user)
    if not course_ids:
        return []
    return (
        db.query(Course)
        .filter(Course.id.in_(course_ids), Course.status == "published")
        .order_by(Course.created_at.asc())
        .all()
    )


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

    # 校验学员已分配该课程（管理员跳过）
    if not check_course_assignment(db, current_user, data.course_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="未分配该课程")

    existing = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.video_id == data.video_id,
        )
        .first()
    )

    if existing:
        # 防刷：根据两次上报的真实时间差限制进度增量（倍速 2x + 网络宽限）
        elapsed = (datetime.now() - existing.last_accessed).total_seconds() if existing.last_accessed else None
        if elapsed is not None and elapsed >= 0:
            max_allowed = existing.watched_seconds + max(elapsed * 2, 10)
            if data.watched_seconds > max_allowed:
                data.watched_seconds = int(max_allowed)
        # 倒退（重看）允许：watched 只增不减的场景按上报值，倒退取较小值避免刷进度
        if data.watched_seconds < existing.watched_seconds:
            data.watched_seconds = existing.watched_seconds

        # 播放器实测时长比库里的更准确（旧数据 total 可能为 0 或 NULL）
        if data.total_seconds > existing.total_seconds:
            existing.total_seconds = data.total_seconds
        existing.watched_seconds = data.watched_seconds
        existing.completed = _is_completed(data.watched_seconds, existing.total_seconds)
        existing.last_accessed = datetime.now()
        # 同步 course_id（防止视频被移动到其他课程）
        if existing.course_id != data.course_id:
            existing.course_id = data.course_id
        db.commit()
    else:
        # 新记录：首次上报限制初始进度（正常从 0 开始播放），防止直接伪造满进度
        init_watched = min(data.watched_seconds, 10)
        progress = LearningProgress(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            course_id=data.course_id,
            video_id=data.video_id,
            watched_seconds=init_watched,
            total_seconds=data.total_seconds,
            completed=_is_completed(init_watched, data.total_seconds),
        )
        db.add(progress)
        try:
            db.commit()
        except IntegrityError:
            # 并发上报时另一请求已插入同一 (user_id, video_id) 记录（唯一约束生效），
            # 回滚后按"已存在"重新处理一次即可，避免 500。
            db.rollback()
            again = (
                db.query(LearningProgress)
                .filter(
                    LearningProgress.user_id == current_user.id,
                    LearningProgress.video_id == data.video_id,
                )
                .first()
            )
            if again:
                again.watched_seconds = max(again.watched_seconds, init_watched)
                again.total_seconds = max(again.total_seconds, data.total_seconds)
                again.completed = _is_completed(again.watched_seconds, again.total_seconds)
                again.last_accessed = datetime.now()
                db.commit()

    return {"ok": True}


@router.get("/progress/{course_id}")
def get_course_progress(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取某课程的进度（线上课程=视频进度；线下课程=签到进度），含考试状态与解锁条件。

    统一口径：`completed_count` / `total_count` 表示「已完成项数 / 应完成项数」，
    线上课程按视频节数计，线下课程按签到场次数计。前端据此无需按课程类型分支。
    """
    # 校验学员已分配该课程（管理员跳过）
    if not check_course_assignment(db, current_user, course_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="未分配该课程")

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程不存在")

    # 检查考试是否通过
    exam_passed = False
    if course.exam_id:
        passed = (
            db.query(ExamResult)
            .filter(
                ExamResult.exam_id == course.exam_id,
                ExamResult.user_id == current_user.id,
                ExamResult.passed == True,  # noqa: E712
            )
            .first()
        )
        exam_passed = passed is not None
    has_exam = course.exam_id is not None

    # ── 统一按视频统计进度；签到信息（若启用）作为附加字段返回 ──
    total_video_count = (
        db.query(func.count(Video.id)).filter(Video.course_id == course_id).scalar()
    ) or 0
    records = (
        db.query(LearningProgress)
        .filter(
            LearningProgress.user_id == current_user.id,
            LearningProgress.course_id == course_id,
        )
        .all()
    )
    completed_count = sum(1 for r in records if r.completed)
    videos_done = total_video_count > 0 and completed_count >= total_video_count

    attendance = None
    if course.require_attendance:
        attendance = course_attendance_detail(db, current_user.id, course)

    return {
        # 历史字段保留（响应兼容）；新前端按 require_attendance 判定
        "course_type": "online",
        "require_attendance": course.require_attendance,
        "unit_label": "节",
        "video_progress": {
            r.video_id: {
                "watched_seconds": r.watched_seconds,
                "total_seconds": r.total_seconds,
                "completed": r.completed,
            }
            for r in records
        },
        "attendance": attendance,
        "completed_count": completed_count,
        "total_count": total_video_count,
        "exam_passed": exam_passed,
        "has_exam": has_exam,
        # 考试只看视频进度；签到是「附加项」，不再卡考试入口
        "can_take_exam": True,
        "blockers": [],
        "completed": videos_done and (not has_exam or exam_passed),
    }


@router.get("/courses-with-progress")
def get_courses_with_progress(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取已分配课程及每门课的进度（管理端切换学员视图时返回全部课程）"""
    # 修复：原先用 department 叶子名反查部门 ID，同名叶子部门会取错人；
    # 且不含子部门。现统一走 department_scope（优先 department_id）。
    course_ids = get_assigned_course_ids(db, current_user)

    if not course_ids:
        return []

    courses = (
        db.query(Course)
        .filter(Course.id.in_(course_ids), Course.status == "published")
        .order_by(Course.created_at.asc())
        .all()
    )

    # 批量获取视频数
    video_counts = dict(
        db.query(Video.course_id, func.count(Video.id))
        .filter(Video.course_id.in_(course_ids))
        .group_by(Video.course_id)
        .all()
    )

    # 批量获取进度（仅线上课程需要视频进度）
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

    # 启用现场签到的课程：批量取「应签到场次数」与「已有效签到场次数」
    attendance_cids = [c.id for c in courses if c.require_attendance]
    sessions_by_course = session_ids_by_course(db, attendance_cids)
    attendance_count = batch_offline_counts(db, [current_user.id], attendance_cids)

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
                ExamResult.passed == True,  # noqa: E712
            )
            .all()
        )
        for pe in passed_exams:
            cid = course_exam_map.get(pe.exam_id)
            if cid:
                exam_passed_map[cid] = True

    result = []
    for c in courses:
        exam_passed = exam_passed_map.get(c.id, False)
        progress_list = progress_by_course.get(c.id, [])
        completed_count = sum(1 for p in progress_list if p.completed)
        total_count = video_counts.get(c.id, 0)
        # 签到附加项（仅启用签到的课程有值）
        attended_count = attendance_count.get((current_user.id, c.id), 0) if c.require_attendance else 0
        required_count = len(sessions_by_course.get(c.id, [])) if c.require_attendance else 0

        result.append({
            "id": c.id,
            "title": c.title,
            "course_type": c.course_type,
            "require_attendance": c.require_attendance,
            "description": c.description,
            "cover_image": c.cover_image,
            "category_id": c.category_id,
            "video_count": video_counts.get(c.id, 0),
            "session_count": required_count,
            "unit_label": "节",
            "status": c.status,
            "start_date": c.start_date.isoformat() if c.start_date else None,
            "end_date": c.end_date.isoformat() if c.end_date else None,
            "completed_count": completed_count,
            "total_count": total_count,
            # 签到附加项（仅 require_attendance=True 时有效）
            "attended_count": attended_count,
            "required_count": required_count,
            "exam_passed": exam_passed,
            "has_exam": c.exam_id is not None,
            "can_take_exam": True,
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

    # 已完成课程数：统一走 progress_service
    # （线上=视频全部完成且考试通过；线下=全部场次签到且考试通过）
    assigned_courses = _assigned_courses(db, current_user)
    completed_courses = completed_course_count(db, current_user.id, assigned_courses)
    assigned_count = len(assigned_courses)

    # 启用现场签到的课程签到统计（并入档案，便于学员看到自己的出勤）
    attendance_courses = [c for c in assigned_courses if c.require_attendance]
    attendance_stat = {"required": 0, "attended": 0, "sessions": 0}
    if attendance_courses:
        counts = batch_progress_map(db, current_user.id, attendance_courses)
        attendance_stat = {
            "required": sum(
                (r.attendance_progress or {}).get("required", 0) for r in counts.values()
            ),
            "attended": sum(
                (r.attendance_progress or {}).get("attended", 0) for r in counts.values()
            ),
            "sessions": len(attendance_courses),
        }

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
        # 启用现场签到的课程出勤汇总（无启用签到的课程时为全 0）
        "attendance_required": attendance_stat["required"],
        "attendance_attended": attendance_stat["attended"],
        "attendance_course_count": attendance_stat["sessions"],
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
    """管理员查看所有学员的学习进度（线上=视频节数，线下=签到场次数）。"""
    courses_query = db.query(Course).order_by(Course.created_at.desc())
    if course_id:
        courses_query = courses_query.filter(Course.id == course_id)
    courses = courses_query.all()
    if not courses:
        return []

    all_ids = [c.id for c in courses]
    video_counts = dict(
        db.query(Video.course_id, func.count(Video.id))
        .filter(Video.course_id.in_(all_ids))
        .group_by(Video.course_id)
        .all()
    )
    # 启用现场签到的课程：单独取其场次数以便按签到统计附加项
    attendance_cids = [c.id for c in courses if c.require_attendance]
    sessions_by_course = session_ids_by_course(db, attendance_cids)

    def total_items(c: Course) -> int:
        # 进度统一按视频统计；签到仅作为附加项
        return video_counts.get(c.id, 0)

    # 只保留「有完成项定义」的课程（无视频不参与统计）
    course_map = {c.id: c for c in courses if total_items(c) > 0}
    if not course_map:
        return []

    user_progress: dict[str, dict[str, int]] = defaultdict(dict)

    # 统一按视频完成度统计（不再区分 online/offline）
    if all_ids:
        progress_rows = (
            db.query(
                LearningProgress.user_id,
                LearningProgress.course_id,
                func.count(LearningProgress.id).label("completed"),
            )
            .filter(
                LearningProgress.completed == True,  # noqa: E712
                LearningProgress.course_id.in_(all_ids),
            )
            .group_by(LearningProgress.user_id, LearningProgress.course_id)
            .all()
        )
        for row in progress_rows:
            user_progress[row.user_id][row.course_id] = row.completed

    user_ids = set(user_progress.keys())
    if not user_ids:
        return []

    students = db.query(User).filter(User.id.in_(user_ids), User.role == "student").all()

    # 启用签到的课程：批量取每名学员的签到场次数（附加信息用）
    attendance_count: dict[tuple[str, str], int] = {}
    if attendance_cids:
        attend_rows = (
            db.query(
                AttendanceRecord.user_id,
                AttendanceRecord.course_id,
                AttendanceRecord.session_id,
            )
            .filter(
                AttendanceRecord.course_id.in_(attendance_cids),
                AttendanceRecord.status.in_(EFFECTIVE_STATUSES),
            )
            .all()
        )
        attend_sets: dict[tuple[str, str], set[str]] = {}
        for uid, cid, sid in attend_rows:
            attend_sets.setdefault((uid, cid), set()).add(sid)
        for (uid, cid), sids in attend_sets.items():
            attendance_count[(uid, cid)] = len(sids)

    result = []
    for student in students:
        course_progress = []
        for cid, course in course_map.items():
            completed = user_progress.get(student.id, {}).get(cid, 0)
            total = total_items(course)
            att_required = len(sessions_by_course.get(cid, [])) if course.require_attendance else 0
            att_attended = attendance_count.get((student.id, cid), 0) if course.require_attendance else 0
            course_progress.append({
                "course_id": cid,
                "course_title": course.title,
                "course_type": course.course_type,
                "require_attendance": course.require_attendance,
                "unit_label": "节",
                "completed_count": completed,
                "total_count": total,
                "attended_count": att_attended,
                "required_count": att_required,
                "progress_pct": round(completed / total * 100) if total else 0,
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


def _build_progress_overview(
    db: Session,
    department_id: str | None,
    course_id: str | None,
) -> list[dict]:
    """学员进度概览的共享实现（/progress/overview 与 /progress/export 同源）。

    统一口径：线上课程按视频节数、线下课程按签到场次数统计完成度，
    因此两个接口不会再出现「一个按视频、一个按签到」的口径漂移。
    """
    # 部门过滤：一次性加载所有部门，在内存中收集子部门名称
    dept_ids: list[str] | None = None
    dept_names: list[str] | None = None
    if department_id:
        dept = db.query(Department).filter(Department.id == department_id).first()
        if not dept:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

        # 修复：原先按部门「名称」匹配用户（User.department.in_(names)），
        # 同名叶子部门会互相串数据。现优先按 department_id 精确匹配（含所有后代部门），
        # 同时保留名称匹配以兼容 department_id 为空的历史数据。
        dept_ids = get_department_scope_ids(db, department_id)
        if dept_ids:
            dept_names = [
                name for (name,) in db.query(Department.name).filter(Department.id.in_(dept_ids)).all()
            ]

    # 课程过滤
    courses_query = db.query(Course).filter(Course.status == "published")
    if course_id:
        courses_query = courses_query.filter(Course.id == course_id)
    courses = courses_query.all()

    # 课程完成项定义：统一按视频数（避免 N+1）
    course_ids = [c.id for c in courses]
    attendance_cids = [c.id for c in courses if c.require_attendance]

    video_counts_raw = (
        db.query(Video.course_id, func.count(Video.id))
        .filter(Video.course_id.in_(course_ids))
        .group_by(Video.course_id)
        .all()
    ) if course_ids else []
    course_video_counts: dict[str, int] = {
        cid: count for cid, count in video_counts_raw if count > 0
    }
    sessions_by_course = session_ids_by_course(db, attendance_cids)

    def total_items(c: Course) -> int:
        # 统一按视频统计
        return course_video_counts.get(c.id, 0)

    # 只保留有视频的课程
    counted_courses = [c for c in courses if total_items(c) > 0]
    if not counted_courses:
        return []

    # 获取学员
    users_query = db.query(User).filter(User.role == "student", User.status == "active")
    if dept_ids:
        name_conditions = [User.department.in_(dept_names)] if dept_names else []
        for name in dept_names or []:
            name_conditions.append(User.department.like(f"%-{name}"))
        users_query = users_query.filter(
            or_(User.department_id.in_(dept_ids), *name_conditions)
        )
    students = users_query.all()

    if not students:
        return []

    student_ids = [s.id for s in students]

    # 统一按视频完成度统计
    user_video_progress: dict[str, dict[str, int]] = defaultdict(dict)
    if course_ids:
        progress_rows = (
            db.query(
                LearningProgress.user_id,
                LearningProgress.course_id,
                func.count(LearningProgress.id).label("completed"),
            )
            .filter(
                LearningProgress.completed == True,  # noqa: E712
                LearningProgress.user_id.in_(student_ids),
                LearningProgress.course_id.in_(course_ids),
            )
            .group_by(LearningProgress.user_id, LearningProgress.course_id)
            .all()
        )
        for row in progress_rows:
            user_video_progress[row.user_id][row.course_id] = row.completed

    # 启用签到的课程：批量取每名学员的签到场次数（附加信息用）
    attendance_count: dict[tuple[str, str], int] = {}
    if attendance_cids:
        attend_rows = (
            db.query(
                AttendanceRecord.user_id,
                AttendanceRecord.course_id,
                AttendanceRecord.session_id,
            )
            .filter(
                AttendanceRecord.user_id.in_(student_ids),
                AttendanceRecord.course_id.in_(attendance_cids),
                AttendanceRecord.status.in_(EFFECTIVE_STATUSES),
            )
            .all()
        )
        attend_sets: dict[tuple[str, str], set[str]] = {}
        for uid, cid, sid in attend_rows:
            attend_sets.setdefault((uid, cid), set()).add(sid)
        for (uid, cid), sids in attend_sets.items():
            attendance_count[(uid, cid)] = len(sids)

    # 课程 -> 考试映射
    course_exam_map: dict[str, str] = {}
    for c in courses:
        if c.exam_id:
            course_exam_map[c.exam_id] = c.id

    # 考试结果统计（取最佳成绩）
    # 性能修复：原先查询这些学员的「全部」考试记录后再在内存里用 course_exam_map 过滤，
    # 学员数与历次考试记录都增长时内存与耗时线性膨胀。现直接在 SQL 层限定相关考试。
    relevant_exam_ids = [c.exam_id for c in courses if c.exam_id]
    if not relevant_exam_ids:
        exam_results = []
    else:
        exam_results = (
            db.query(ExamResult)
            .filter(
                ExamResult.user_id.in_(student_ids),
                ExamResult.exam_id.in_(relevant_exam_ids),
            )
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
        for c in counted_courses:
            cid = c.id
            completed = user_video_progress.get(student.id, {}).get(cid, 0)
            total_count = total_items(c)
            exam_info = user_exam_info.get(student.id, {}).get(cid, {})
            att_required = len(sessions_by_course.get(cid, [])) if c.require_attendance else 0
            att_attended = attendance_count.get((student.id, cid), 0) if c.require_attendance else 0
            course_progress.append({
                "course_id": cid,
                "course_title": c.title,
                "course_type": c.course_type,
                "require_attendance": c.require_attendance,
                "unit_label": "节",
                # completed_count / total_count 为统一口径；
                # video_completed / video_total 保留旧字段名以兼容既有前端导出逻辑
                "completed_count": completed,
                "total_count": total_count,
                "video_completed": completed,
                "video_total": total_count,
                "attended_count": att_attended,
                "required_count": att_required,
                "progress_pct": round(completed / total_count * 100) if total_count else 0,
                "exam_passed": exam_info.get("passed", False),
                "has_exam": c.exam_id is not None,
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


@admin_router.get("/progress/overview")
def admin_progress_overview(
    department_id: str | None = Query(None),
    course_id: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理员查看所有学员的课程进度概览（含考试状态与出勤）。"""
    return _build_progress_overview(db, department_id, course_id)


@admin_router.get("/progress/export")
def admin_progress_export(
    department_id: str | None = Query(None),
    course_id: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """导出学员进度为 Excel。

    与 /progress/overview 共用同一份计算逻辑，避免「页面上看到的」与
    「导出的」不一致（历史上这里是复制粘贴出来的第二份实现，且仍按视频口径统计）。
    """
    rows = _build_progress_overview(db, department_id, course_id)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "学员进度"

    header_font = Font(name="微软雅黑", bold=True, size=11, color="FFFFFF")
    header_fill = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin", color="C0C0C0"),
        right=Side(style="thin", color="C0C0C0"),
        top=Side(style="thin", color="C0C0C0"),
        bottom=Side(style="thin", color="C0C0C0"),
    )
    sample_font = Font(name="微软雅黑", size=10)
    pct_font = Font(name="微软雅黑", size=10, color="1B365D")
    done_font = Font(name="微软雅黑", size=10, color="2E7D32")

    headers = [
        "序号", "姓名", "用户名", "部门", "课程", "课程类型",
        "完成数", "总数", "单位", "完成率", "考试通过", "最佳成绩", "考试次数",
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    row_idx = 2
    seq = 0
    for student in rows:
        for c in student["courses"]:
            total = c.get("total_count") or 0
            completed = c.get("completed_count") or 0
            has_exam = c.get("has_exam")
            exam_passed = c.get("exam_passed", False)
            # 完成率：有考试时「完成项占 80% + 考试通过占 20%」，无考试时完成项占 100%
            if has_exam:
                pct = (round(completed / total * 80) if total else 0) + (20 if exam_passed else 0)
            else:
                pct = round(completed / total * 100) if total else (100 if exam_passed else 0)

            seq += 1
            vals = [
                seq, student["user_name"], student["username"], student["department"] or "",
                c["course_title"],
                "线上（含现场签到）" if c.get("require_attendance") else "线上",
                completed, total, c.get("unit_label", ""),
                f"{pct}%",
                "是" if exam_passed else "否",
                c.get("exam_best_score") if c.get("exam_best_score") is not None else "",
                c.get("exam_attempts") or "",
            ]
            for col_idx, val in enumerate(vals, start=1):
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.font = sample_font
                cell.alignment = Alignment(vertical="center", wrap_text=True)
                cell.border = thin_border
                if col_idx == 10:
                    cell.font = pct_font
                if col_idx == 11 and exam_passed:
                    cell.font = done_font
            row_idx += 1

    col_widths = [6, 10, 12, 14, 28, 10, 10, 8, 8, 10, 10, 10, 10]
    for i, width in enumerate(col_widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E8%BF%9B%E5%BA%A6.xlsx"},
    )


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

    # 启用现场签到的课程：附带该学员的签到明细（供管理员核对出勤与异常）
    attendance = None
    if course and course.require_attendance:
        records = {
            r.session_id: r
            for r in db.query(AttendanceRecord).filter(
                AttendanceRecord.user_id == user_id,
                AttendanceRecord.course_id == course_id,
            ).all()
        }
        now = datetime.now()
        items = []
        attended = 0
        for sess in load_sessions(db, course_id):
            rec = records.get(sess.id)
            ok = rec is not None and rec.status in EFFECTIVE_STATUSES
            if ok:
                attended += 1
            items.append({
                "session_id": sess.id,
                "title": sess.title,
                "start_time": sess.start_time.isoformat(),
                "end_time": sess.end_time.isoformat(),
                "location_name": sess.location_name,
                "state": session_state(sess, now),
                "checked_in": ok,
                "status": rec.status if rec else None,
                "checked_in_at": rec.checked_in_at.isoformat() if rec else None,
                "risk_flags": (rec.risk_flags or []) if rec else [],
                "client_ip": rec.client_ip if rec else None,
            })
        attendance = {
            "required_count": len(items),
            "attended_count": attended,
            "sessions": items,
        }

    return {
        "videos": video_details,
        "exams": exam_details,
        "course_type": course.course_type if course else "online",
        "require_attendance": course.require_attendance if course else False,
        "attendance": attendance,
        "progress": (
            batch_progress_map(db, user_id, [course]).get(course_id)
            if course else None
        ),
    }