"""课程管理路由"""

import uuid
from app.services.log_service import write_log
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
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
            id=c.id, title=c.title, description=c.description,
            cover_image=c.cover_image, category_id=c.category_id,
            exam_id=c.exam_id, status=c.status,
            start_date=c.start_date, end_date=c.end_date,
            created_by=c.created_by, created_at=c.created_at,
            updated_at=c.updated_at,
            chapters=course_chapters,
            videos=root_videos,
            video_count=total_video_count,
        ))
    return result


router = APIRouter(prefix="/api", tags=["课程管理"])


# ========== 课程 ==========

def _collect_category_ids(db: Session, category_id: str) -> list[str]:
    """递归收集分类及其所有子分类的 ID"""
    ids = [category_id]
    children = db.query(QuestionCategory).filter(QuestionCategory.parent_id == category_id).all()
    for child in children:
        ids.extend(_collect_category_ids(db, child.id))
    return ids


@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    category_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(Course)
    if category_id:
        cat_ids = _collect_category_ids(db, category_id)
        q = q.filter(Course.category_id.in_(cat_ids))
    if status:
        q = q.filter(Course.status == status)
    if search:
        q = q.filter(Course.title.contains(search))
    courses = q.order_by(Course.created_at.desc()).all()
    return _courses_with_chapters(db, courses)


@router.post("/courses", response_model=CourseOut)
def create_course(data: CourseCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    course = Course(
        id=str(uuid.uuid4()),
        title=data.title, description=data.description, cover_image=data.cover_image,
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
        id=course.id, title=course.title, description=course.description,
        cover_image=course.cover_image, category_id=course.category_id,
        exam_id=course.exam_id, status=course.status,
        start_date=course.start_date, end_date=course.end_date,
        created_by=course.created_by, created_at=course.created_at,
        updated_at=course.updated_at, chapters=[], videos=[], video_count=0,
    )


@router.get("/courses/{course_id}", response_model=CourseOut)
def get_course(course_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    return _courses_with_chapters(db, [course])[0]


@router.put("/courses/{course_id}", response_model=CourseOut)
def update_course(course_id: str, data: CourseUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="course", action="update", resource_type="课程", resource_name=course.title if hasattr(course, 'title') else "", description=f"{current_user.name} 编辑了课程「{course.title}」", level="info")
    return _courses_with_chapters(db, [course])[0]


@router.delete("/courses/{course_id}")
def delete_course(course_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="course", action="delete", resource_type="课程", resource_name=course.title if hasattr(course, 'title') else "", description=f"{current_user.name} 删除了课程「{course.title}」", level="warning")
    from app.models.course import CourseAssignment
    from app.models.learning_progress import LearningProgress
    from app.models.exam import Exam, ExamPaper, ExamResult
    db.query(LearningProgress).filter(LearningProgress.course_id == course_id).delete()
    # 删除关联考试及考试结果、试卷
    exam_ids = [e.id for e in db.query(Exam).filter(Exam.course_id == course_id).all()]
    if exam_ids:
        db.query(ExamResult).filter(ExamResult.exam_id.in_(exam_ids)).delete()
        db.query(ExamPaper).filter(ExamPaper.exam_id.in_(exam_ids)).delete()
        db.query(Exam).filter(Exam.course_id == course_id).delete()
    db.query(CourseAssignment).filter(CourseAssignment.course_id == course_id).delete()
    db.query(Video).filter(Video.course_id == course_id).delete()
    db.query(Chapter).filter(Chapter.course_id == course_id).delete()
    db.delete(course)
    db.commit()
    return {"ok": True}


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
def delete_video(video_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")
    # 先删除关联的学习进度记录（外键约束）
    from app.models.learning_progress import LearningProgress
    db.query(LearningProgress).filter(LearningProgress.video_id == video_id).delete()
    db.delete(video)
    db.commit()
    return {"ok": True}


# ========== 学员端课程 ==========

@router.get("/student/courses", response_model=list[CourseOut])
def student_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取分配给当前学员的课程"""
    from app.models.course import CourseAssignment

    # 查找用户所属部门的 ID（user.department 存的是名称，需转换为 ID）
    dept_id = None
    if current_user.department:
        _dept = current_user.department.split("-")[-1]  # 从完整路径中取叶子名
        dept = db.query(Department).filter(Department.name == _dept).first()
        if dept:
            dept_id = dept.id

    # 获取分配给该用户或其部门的课程
    conditions = [CourseAssignment.user_id == current_user.id]
    if dept_id:
        conditions.append(CourseAssignment.department_id == dept_id)

    assignments = (
        db.query(CourseAssignment)
        .filter(or_(*conditions))
        .all()
    )
    course_ids = list(set(a.course_id for a in assignments))
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