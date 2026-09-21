"""课程管理路由"""

import uuid
from app.logger import get_logger
from app.services.log_service import write_log
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import or_, func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.course import Course, Chapter, Video
from app.models.department import Department
from app.models.question_category import QuestionCategory
from app.schemas.course import (
    CourseCreate, CourseUpdate,
    CourseOut, VideoCreate, VideoOut, VideoReorder,
    ChapterCreate, ChapterUpdate, ChapterOut, ChapterReorder,
)
from app.routers.auth import get_current_user, require_admin
from app.routers.videos import delete_oss_object
from app.services.department_scope import (
    check_course_assignment,
    get_assigned_course_ids,
    get_department_scope_ids,
)
from pydantic import BaseModel


class AssignRequest(BaseModel):
    user_ids: list[str] = []
    department_ids: list[str] = []


def _courses_with_chapters(db: Session, courses: list[Course]) -> list[CourseOut]:
    """批量查询章节和视频，组装 CourseOut（Course → Chapter → Video 三层），避免 N+1"""
    if not courses:
        return []
    course_ids = [c.id for c in courses]
    # 查询所有章节
    all_chapters = (
        db.query(Chapter)
        .filter(Chapter.course_id.in_(course_ids))
        .order_by(Chapter.sort_order)
        .all()
    )
    chapter_ids = [ch.id for ch in all_chapters]
    # 查询所有视频
    all_videos = (
        db.query(Video)
        .filter(Video.course_id.in_(course_ids))
        .order_by(Video.sort_order)
        .all()
    )
    # 章节 → 视频映射
    videos_by_chapter: dict[str, list[Video]] = defaultdict(list)
    orphan_videos: dict[str, list[Video]] = defaultdict(list)  # 无章节的视频
    for v in all_videos:
        if v.chapter_id:
            videos_by_chapter[v.chapter_id].append(v)
        else:
            orphan_videos[v.course_id].append(v)
    # 课程 → 章节映射
    chapters_by_course: dict[str, list[Chapter]] = defaultdict(list)
    for ch in all_chapters:
        chapters_by_course[ch.course_id].append(ch)

    # 线下课程的签到场次数（一次查询，避免逐课程查库）
    from app.models.attendance import AttendanceSession

    session_counts = dict(
        db.query(AttendanceSession.course_id, func.count(AttendanceSession.id))
        .filter(AttendanceSession.course_id.in_(course_ids))
        .group_by(AttendanceSession.course_id)
        .all()
    )

    result: list[CourseOut] = []
    for c in courses:
        course_chapters: list[ChapterOut] = []
        for ch in chapters_by_course.get(c.id, []):
            course_chapters.append(ChapterOut(
                id=ch.id, course_id=ch.course_id, title=ch.title,
                sort_order=ch.sort_order,
                videos=[VideoOut.model_validate(v) for v in videos_by_chapter.get(ch.id, [])],
            ))
        # 不归属任何章节的视频放到根级别 videos 里（兼容）
        root_videos = [VideoOut.model_validate(v) for v in orphan_videos.get(c.id, [])]
        total_video_count = sum(len(ch.videos) for ch in course_chapters) + len(root_videos)
        result.append(CourseOut(
            id=c.id, title=c.title, course_type=c.course_type,
            require_attendance=c.require_attendance,
            description=c.description,
            cover_image=c.cover_image, category_id=c.category_id,
            exam_id=c.exam_id, status=c.status,
            start_date=c.start_date, end_date=c.end_date,
            created_by=c.created_by, created_at=c.created_at,
            updated_at=c.updated_at,
            chapters=course_chapters,
            videos=root_videos,
            video_count=total_video_count,
            session_count=session_counts.get(c.id, 0),
        ))
    return result


router = APIRouter(prefix="/api", tags=["课程管理"])

logger = get_logger(__name__)


# ========== 课程 ==========

def _collect_category_ids(db: Session, category_id: str) -> list[str]:
    """递归收集分类及其所有子分类的 ID。

    性能修复：原实现每层都发一次 SQL（N+1），分类树较深时查询次数线性增长。
    现一次性加载 id/parent_id 映射后在内存中遍历。
    """
    rows = db.query(QuestionCategory.id, QuestionCategory.parent_id).all()
    children_map: dict[str, list[str]] = {}
    for cid, pid in rows:
        if pid:
            children_map.setdefault(pid, []).append(cid)

    ids: list[str] = []
    stack = [category_id]
    seen: set[str] = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        ids.append(cur)
        stack.extend(children_map.get(cur, []))
    return ids


@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    response: Response,
    category_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    page: int | None = Query(None, ge=1, description="页码（不传则返回全部，保持向后兼容）"),
    page_size: int | None = Query(None, ge=1, le=500, description="每页数量"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取课程列表（新增可选分页：page/page_size + X-Total-Count 响应头）。

    注意：课程详情装配（章节+视频）成本与课程数成正比，数据量增大后
    建议前端改用分页参数，避免一次性拉取全部课程。
    """
    q = db.query(Course)
    if category_id:
        cat_ids = _collect_category_ids(db, category_id)
        q = q.filter(Course.category_id.in_(cat_ids))
    if status:
        q = q.filter(Course.status == status)
    if search:
        q = q.filter(Course.title.contains(search))

    q = q.order_by(Course.created_at.desc())
    if page and page_size:
        response.headers["X-Total-Count"] = str(q.count())
        courses = q.offset((page - 1) * page_size).limit(page_size).all()
    else:
        courses = q.all()
    return _courses_with_chapters(db, courses)


@router.post("/courses", response_model=CourseOut)
def create_course(data: CourseCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    # 不再强校验 course_type（历史字段保留兼容）；新逻辑统一由 require_attendance 控制
    course = Course(
        id=str(uuid.uuid4()),
        title=data.title,
        course_type=data.course_type or "online",   # 兼容老调用方
        require_attendance=data.require_attendance,
        description=data.description, cover_image=data.cover_image,
        category_id=data.category_id, exam_id=data.exam_id,
        start_date=data.start_date, end_date=data.end_date,
        status=data.status or "draft",
        created_by=current_user.id,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="course", action="create", resource_type="课程", resource_name=course.title if hasattr(course, 'title') else "", description=f"{current_user.name} 创建了课程「{course.title}」", level="info")
    return CourseOut(
        id=course.id, title=course.title, course_type=course.course_type,
        require_attendance=course.require_attendance,
        description=course.description,
        cover_image=course.cover_image, category_id=course.category_id,
        exam_id=course.exam_id, status=course.status,
        start_date=course.start_date, end_date=course.end_date,
        created_by=course.created_by, created_at=course.created_at,
        updated_at=course.updated_at, chapters=[], videos=[], video_count=0,
        session_count=0,
    )


@router.get("/courses/{course_id}", response_model=CourseOut)
def get_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取课程详情。

    安全修复：原实现只校验「已登录」，任何学员都能读取未分配给自己的课程详情
    （含视频 obs_key），配合视频接口即可越权播放。现增加课程分配校验。
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    if not check_course_assignment(db, current_user, course_id):
        raise HTTPException(status_code=403, detail="未分配该课程")
    return _courses_with_chapters(db, [course])[0]


@router.put("/courses/{course_id}", response_model=CourseOut)
def update_course(course_id: str, data: CourseUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    update_data = data.model_dump(exclude_unset=True)
    # 非空字段不能被显式置为 null，否则会触发数据库 NOT NULL 约束报 500
    for non_nullable in ("title", "status"):
        if non_nullable in update_data and update_data[non_nullable] is None:
            update_data.pop(non_nullable)
    # 记录 require_attendance 切换（不再用 course_type 判定，但保留切换审计）
    if "require_attendance" in update_data and update_data["require_attendance"] != course.require_attendance:
        logger.info(
            "课程「%s」 require_attendance 由 %s 切换为 %s（操作人：%s）",
            course.title, course.require_attendance, update_data["require_attendance"], current_user.name,
        )

    for field, value in update_data.items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="course", action="update", resource_type="课程", resource_name=course.title if hasattr(course, 'title') else "", description=f"{current_user.name} 编辑了课程「{course.title}」", level="info")
    return _courses_with_chapters(db, [course])[0]


@router.delete("/courses/{course_id}")
def delete_course(
    course_id: str,
    confirm: bool = Query(False, description="必须显式传 true 才执行删除"),
    force: bool = Query(False, description="课程已有学习/考试记录时，需再传 force=true 才会连历史一并删除"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除课程（级联删除章节、视频、考试、分配、学习进度、签到场次与记录）。

    修复（防误删 + 保护历史）：
    - 必须显式 `confirm=true`
    - 若课程下已有学习进度、考试记录或签到记录，默认**拒绝删除**（返回 409），
      请改用「下架（status=draft）」保留历史；确实要连历史一起删，再传 `force=true`
    - 同步清理 OSS 上的视频对象（原先只删库，对象永久残留）

    Bug 修复：原先未清理 `attendance_sessions` / `attendance_records`，
    而这两张表都以 course_id 外键引用 courses，导致开启过签到的课程删除时
    MySQL 抛 1451 外键约束错误 → 接口 500。现按「签到记录 → 签到场次 → 课程」
    的顺序清理（records 也引用 sessions，必须先删）。
    """
    if not confirm:
        raise HTTPException(status_code=400, detail="删除课程需要显式确认（confirm=true）")

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    from app.models.course import CourseAssignment
    from app.models.learning_progress import LearningProgress
    from app.models.exam import Exam, ExamPaper, ExamResult
    from app.models.attendance import AttendanceRecord, AttendanceSession

    exam_ids = [e.id for e in db.query(Exam).filter(Exam.course_id == course_id).all()]

    progress_count = (
        db.query(LearningProgress).filter(LearningProgress.course_id == course_id).count()
    )
    result_count = (
        db.query(ExamResult).filter(ExamResult.exam_id.in_(exam_ids)).count() if exam_ids else 0
    )
    session_ids = [
        s.id for s in db.query(AttendanceSession).filter(AttendanceSession.course_id == course_id).all()
    ]
    # 签到记录既可能凭 course_id 关联，也可能只凭 session_id 关联（历史脏数据），两者都算
    attendance_filter = AttendanceRecord.course_id == course_id
    if session_ids:
        attendance_filter = or_(attendance_filter, AttendanceRecord.session_id.in_(session_ids))
    attendance_count = db.query(AttendanceRecord).filter(attendance_filter).count()
    if (progress_count or result_count or attendance_count) and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"该课程已产生学习记录（学习进度 {progress_count} 条、考试记录 {result_count} 条、"
                f"签到记录 {attendance_count} 条），"
                "为避免误删学员历史数据已阻止删除。"
                "如只需停止发放请改为「下架」；如确认要连历史一并删除，请传 force=true。"
            ),
        )

    # 收集 OSS 对象，待数据库事务提交后再清理
    obs_keys = [v.obs_key for v in db.query(Video).filter(Video.course_id == course_id).all() if v.obs_key]

    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="course", action="delete", resource_type="课程", resource_name=course.title if hasattr(course, 'title') else "", description=f"{current_user.name} 删除了课程「{course.title}」", level="warning")
    db.query(LearningProgress).filter(LearningProgress.course_id == course_id).delete()
    # 删除关联考试及考试结果、试卷
    if exam_ids:
        db.query(ExamResult).filter(ExamResult.exam_id.in_(exam_ids)).delete()
        db.query(ExamPaper).filter(ExamPaper.exam_id.in_(exam_ids)).delete()
        db.query(Exam).filter(Exam.course_id == course_id).delete()
    db.query(CourseAssignment).filter(CourseAssignment.course_id == course_id).delete()
    db.query(Video).filter(Video.course_id == course_id).delete()
    db.query(Chapter).filter(Chapter.course_id == course_id).delete()
    # 签到：先删记录（引用场次与课程），再删场次，最后才能删课程
    db.query(AttendanceRecord).filter(
        AttendanceRecord.course_id == course_id
    ).delete(synchronize_session=False)
    if session_ids:
        db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id.in_(session_ids)
        ).delete(synchronize_session=False)
    db.query(AttendanceSession).filter(
        AttendanceSession.course_id == course_id
    ).delete(synchronize_session=False)
    db.delete(course)
    db.commit()

    # 事务成功后再删对象存储
    removed = sum(1 for k in obs_keys if delete_oss_object(k))
    return {"ok": True, "deleted_oss_objects": removed}


# ========== 章节 ==========

@router.post("/courses/{course_id}/chapters", response_model=ChapterOut)
def create_chapter(
    course_id: str, data: ChapterCreate,
    db: Session = Depends(get_db), _: User = Depends(require_admin),
):
    """创建章节"""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    max_order = db.query(Chapter).filter(Chapter.course_id == course_id).count()
    chapter = Chapter(
        id=str(uuid.uuid4()),
        course_id=course_id, title=data.title, sort_order=max_order,
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return ChapterOut(
        id=chapter.id, course_id=chapter.course_id, title=chapter.title,
        sort_order=chapter.sort_order, videos=[],
    )


@router.put("/chapters/{chapter_id}", response_model=ChapterOut)
def update_chapter(
    chapter_id: str, data: ChapterUpdate,
    db: Session = Depends(get_db), _: User = Depends(require_admin),
):
    """更新章节（重命名）"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    if data.title is not None:
        chapter.title = data.title
    db.commit()
    db.refresh(chapter)
    videos = db.query(Video).filter(Video.chapter_id == chapter_id).order_by(Video.sort_order).all()
    return ChapterOut(
        id=chapter.id, course_id=chapter.course_id, title=chapter.title,
        sort_order=chapter.sort_order,
        videos=[VideoOut.model_validate(v) for v in videos],
    )


@router.delete("/chapters/{chapter_id}")
def delete_chapter(
    chapter_id: str,
    db: Session = Depends(get_db), _: User = Depends(require_admin),
):
    """删除章节（下属视频 chapter_id 置为 NULL）"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    # 章节下视频取消归属
    db.query(Video).filter(Video.chapter_id == chapter_id).update(
        {"chapter_id": None}, synchronize_session=False
    )
    db.delete(chapter)
    db.commit()
    return {"ok": True}


@router.put("/courses/{course_id}/chapters/reorder")
def reorder_chapters(
    course_id: str, data: ChapterReorder,
    db: Session = Depends(get_db), _: User = Depends(require_admin),
):
    """章节排序"""
    for i, ch_id in enumerate(data.chapter_ids):
        db.query(Chapter).filter(
            Chapter.id == ch_id, Chapter.course_id == course_id
        ).update({"sort_order": i})
    db.commit()
    return {"ok": True}


# ========== 视频 ==========

@router.post("/courses/{course_id}/videos", response_model=VideoOut)
def add_video(course_id: str, data: VideoCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    if data.chapter_id:
        chapter = db.query(Chapter).filter(Chapter.id == data.chapter_id, Chapter.course_id == course_id).first()
        if not chapter:
            raise HTTPException(status_code=400, detail="章节不存在或不属于该课程")
    max_order = db.query(Video).filter(Video.course_id == course_id).count()
    video = Video(
        id=str(uuid.uuid4()),
        course_id=course_id, chapter_id=data.chapter_id,
        title=data.title, obs_key=data.obs_key,
        file_size=data.file_size, duration=data.duration,
        sort_order=max_order,
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return VideoOut.model_validate(video)


@router.put("/videos/{video_id}", response_model=VideoOut)
def update_video(
    video_id: str, data: VideoCreate,
    db: Session = Depends(get_db), _: User = Depends(require_admin),
):
    """更新视频信息（含所属章节）"""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")
    if data.chapter_id is not None:
        if data.chapter_id:
            chapter = db.query(Chapter).filter(
                Chapter.id == data.chapter_id, Chapter.course_id == video.course_id
            ).first()
            if not chapter:
                raise HTTPException(status_code=400, detail="章节不存在或不属于该课程")
        video.chapter_id = data.chapter_id
    if data.title:
        video.title = data.title
    if data.obs_key:
        video.obs_key = data.obs_key
    db.commit()
    db.refresh(video)
    return VideoOut.model_validate(video)


@router.put("/courses/{course_id}/videos/reorder")
def reorder_videos(course_id: str, data: VideoReorder, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    for i, vid in enumerate(data.video_ids):
        db.query(Video).filter(Video.id == vid, Video.course_id == course_id).update({"sort_order": i})
    db.commit()
    return {"ok": True}


@router.delete("/videos/{video_id}")
def delete_video(
    video_id: str,
    confirm: bool = Query(False, description="必须显式传 true 才执行删除"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除视频（含学习进度记录与 OSS 对象）。

    修复：
    - 增加 `confirm=true` 显式确认，避免误调用直接删数据
    - 同步删除 OSS 上的视频对象（原先只删库，对象永久残留）
    """
    if not confirm:
        raise HTTPException(status_code=400, detail="删除视频需要显式确认（confirm=true）")

    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")

    obs_key = video.obs_key
    # 先删除关联的学习进度记录（外键约束）
    from app.models.learning_progress import LearningProgress
    db.query(LearningProgress).filter(LearningProgress.video_id == video_id).delete()
    db.delete(video)
    db.commit()

    # 数据库事务成功后再清理对象存储，避免回滚后文件已丢失
    delete_oss_object(obs_key)

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="course", action="delete", resource_type="视频",
        resource_name=video.title,
        description=f"{current_user.name} 删除了视频「{video.title}」", level="warning",
    )
    return {"ok": True}


# ========== 学员端课程 ==========

@router.get("/student/courses", response_model=list[CourseOut])
def student_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取分配给当前学员的课程。

    修复：原先用 `department.split("-")[-1]` + `Department.name == 叶子名` 反查部门，
    同名叶子部门会取到任意一个，导致课程可见性错误。
    现统一走 department_scope（优先 department_id 外键，且包含子/父部门）。
    """
    course_ids = get_assigned_course_ids(db, current_user)
    if not course_ids:
        return []
    courses = (
        db.query(Course)
        .filter(Course.id.in_(course_ids), Course.status == "published")
        .order_by(Course.created_at.asc())
        .all()
    )
    return _courses_with_chapters(db, courses)


# ========== 课程分配 ==========


@router.get("/courses/{course_id}/assignments")
def get_assignments(
    course_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取课程分配情况"""
    from app.models.course import CourseAssignment
    from app.models.department import Department
    assignments = db.query(CourseAssignment).filter(CourseAssignment.course_id == course_id).all()
    user_ids = [a.user_id for a in assignments if a.user_id]
    dept_ids = [a.department_id for a in assignments if a.department_id]
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
    depts = db.query(Department).filter(Department.id.in_(dept_ids)).all() if dept_ids else []
    return {
        "users": [{"id": u.id, "name": u.name, "department": u.department} for u in users],
        "departments": [{"id": d.id, "name": d.name} for d in depts],
    }


@router.post("/courses/{course_id}/assignments")
def assign_course(
    course_id: str,
    data: AssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """分配课程给学员/部门"""
    from app.models.course import CourseAssignment
    assigned = 0
    for uid in data.user_ids:
        existing = db.query(CourseAssignment).filter(
            CourseAssignment.course_id == course_id, CourseAssignment.user_id == uid
        ).first()
        if not existing:
            db.add(CourseAssignment(
                id=str(uuid.uuid4()), course_id=course_id, user_id=uid,
                assigned_by=current_user.id,
            ))
            assigned += 1
    for did in data.department_ids:
        existing = db.query(CourseAssignment).filter(
            CourseAssignment.course_id == course_id, CourseAssignment.department_id == did
        ).first()
        if not existing:
            db.add(CourseAssignment(
                id=str(uuid.uuid4()), course_id=course_id, department_id=did,
                assigned_by=current_user.id,
            ))
            assigned += 1
    db.commit()
    return {"assigned": assigned}


@router.delete("/courses/{course_id}/assignments")
def remove_assignment(
    course_id: str,
    data: AssignRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """移除课程分配"""
    from app.models.course import CourseAssignment
    for uid in data.user_ids:
        db.query(CourseAssignment).filter(
            CourseAssignment.course_id == course_id, CourseAssignment.user_id == uid
        ).delete()
    for did in data.department_ids:
        db.query(CourseAssignment).filter(
            CourseAssignment.course_id == course_id, CourseAssignment.department_id == did
        ).delete()
    db.commit()
    return {"ok": True}