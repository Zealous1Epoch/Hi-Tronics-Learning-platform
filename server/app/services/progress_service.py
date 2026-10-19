"""课程进度统一口径。

统一线上课程形态下：
- 进度完成项 = 视频节数（必选，所有课程都按视频统计）
- 配置了签到场次（AttendanceSession）的课程，签到作为可选项返回附加进度
  （attendance_progress: {required, attended, satisfied}），不参与主进度计算。
  2026-10-19 起签到不再区分课程类型：任何课程都可配场次，有场次即有附加进度。

对外统一暴露 `completed_count / total_count / unit_label`，使「我的课程」「学习档案」
「管理端学员进度」「代办任务」等所有页面无需按课程类型写分支即可正确显示。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.course import Course, Video
from app.models.exam import ExamResult
from app.models.learning_progress import LearningProgress
from app.services.attendance_service import (
    batch_offline_counts,
    session_ids_by_course,
)


@dataclass(frozen=True)
class ProgressRow:
    course_id: str
    # 历史字段保留（响应兼容）；签到口径由场次驱动，不再读课程类型开关
    course_type: str
    completed_count: int
    total_count: int
    # 统一为「节」（视频统计口径）；签到作为可选附加项
    unit_label: str
    satisfied: bool          # 完成项全部达标（视频全部看完）
    exam_passed: bool
    has_exam: bool
    can_take_exam: bool
    completed: bool          # 课程整体完成；无视频课程：有考试且过考才算完成，纯课件不算
    # 签到附加进度：课程配置了签到场次时才有值
    # {"required": int, "attended": int, "satisfied": bool}
    attendance_progress: dict | None = None


def _exam_passed_map(db: Session, user_id: str, courses: list[Course]) -> dict[str, bool]:
    exam_ids = [c.exam_id for c in courses if c.exam_id]
    if not exam_ids:
        return {}
    rows = (
        db.query(ExamResult.exam_id)
        .filter(
            ExamResult.user_id == user_id,
            ExamResult.exam_id.in_(exam_ids),
            ExamResult.passed == True,  # noqa: E712
        )
        .all()
    )
    passed = {r[0] for r in rows}
    return {c.id: (c.exam_id in passed) for c in courses if c.exam_id}


def batch_progress_map(
    db: Session, user_id: str, courses: list[Course]
) -> dict[str, ProgressRow]:
    """一次性算出某学员在给定课程集合上的进度（统一按视频统计 + 签到作为可选附加项）。"""
    if not courses:
        return {}

    exam_passed_map = _exam_passed_map(db, user_id, courses)
    course_ids = [c.id for c in courses]

    # ── 视频完成度（统一口径，所有课程都按视频统计）──
    video_totals: dict[str, int] = dict(
        db.query(Video.course_id, func.count(Video.id))
        .filter(Video.course_id.in_(course_ids))
        .group_by(Video.course_id)
        .all()
    )
    video_done: dict[str, int] = {
        cid: n
        for cid, n in db.query(
            LearningProgress.course_id, func.count(LearningProgress.id)
        )
        .filter(
            LearningProgress.user_id == user_id,
            LearningProgress.course_id.in_(course_ids),
            LearningProgress.completed == True,  # noqa: E712
        )
        .group_by(LearningProgress.course_id)
        .all()
    }

    # ── 签到附加项（场次驱动：session_ids_by_course 只返回有场次的课程）──
    sessions_by_course = session_ids_by_course(db, course_ids)
    attendance_cids = [cid for cid, ids in sessions_by_course.items() if ids]
    if attendance_cids:
        attend_counts = batch_offline_counts(db, [user_id], attendance_cids)
    else:
        attend_counts = {}

    out: dict[str, ProgressRow] = {}
    for c in courses:
        has_exam = c.exam_id is not None
        exam_passed = exam_passed_map.get(c.id, False)
        total = video_totals.get(c.id, 0)
        done = video_done.get(c.id, 0)

        attendance_progress = None
        if sessions_by_course.get(c.id):
            req = len(sessions_by_course[c.id])
            att_n = attend_counts.get((user_id, c.id), 0)
            attendance_progress = {
                "required": req,
                "attended": att_n,
                "satisfied": req > 0 and att_n >= req,
            }

        satisfied = total > 0 and done >= total
        # 考试解锁只看视频进度；签到是「附加项」，不再卡考试入口
        can_take = True

        # 完成口径与前端 isCourseDone 对齐：
        # 课件（PDF/PPT/HTML）是与视频平级的第一等内容，但不采集阅读进度。
        # 无视频课程：有考试则过考即完成；纯课件无考试不算完成（无可验证的学习痕迹）。
        if total == 0:
            completed = has_exam and exam_passed
        else:
            completed = done >= total and (not has_exam or exam_passed)

        out[c.id] = ProgressRow(
            course_id=c.id,
            course_type=c.course_type,
            completed_count=done,
            total_count=total,
            unit_label="节",
            satisfied=satisfied,
            exam_passed=exam_passed,
            has_exam=has_exam,
            can_take_exam=can_take,
            completed=completed,
            attendance_progress=attendance_progress,
        )
    return out


def completed_course_count(db: Session, user_id: str, courses: list[Course]) -> int:
    """已完成课程数（视频全部看完且考试通过或无考试）。"""
    return sum(1 for row in batch_progress_map(db, user_id, courses).values() if row.completed)
