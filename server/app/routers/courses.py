"""课程管理路由"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.course import CourseCategory, Course, Video
from app.schemas.course import (
    CategoryCreate, CategoryOut, CourseCreate, CourseUpdate,
    CourseOut, VideoCreate, VideoOut, VideoReorder,
)
from app.routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/api", tags=["课程管理"])


# ========== 课程分类 ==========

def build_category_tree(categories: list[CourseCategory], parent_id: str | None = None) -> list[CategoryOut]:
    children = [c for c in categories if c.parent_id == parent_id]
    return [
        CategoryOut(id=c.id, name=c.name, parent_id=c.parent_id, sort_order=c.sort_order,
                     children=build_category_tree(categories, c.id))
        for c in sorted(children, key=lambda x: x.sort_order)
    ]


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return build_category_tree(db.query(CourseCategory).all())


@router.post("/categories", response_model=CategoryOut)
def create_category(data: CategoryCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cat = CourseCategory(name=data.name, parent_id=data.parent_id)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return CategoryOut(id=cat.id, name=cat.name, parent_id=cat.parent_id, sort_order=cat.sort_order, children=[])


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cat = db.query(CourseCategory).filter(CourseCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    db.delete(cat)
    db.commit()
    return {"ok": True}


# ========== 课程 ==========

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
        q = q.filter(Course.category_id == category_id)
    if status:
        q = q.filter(Course.status == status)
    if search:
        q = q.filter(Course.title.contains(search))
    courses = q.order_by(Course.created_at.desc()).all()
    result = []
    for c in courses:
        videos = db.query(Video).filter(Video.course_id == c.id).order_by(Video.sort_order).all()
        result.append(CourseOut(
            id=c.id, title=c.title, description=c.description, cover_image=c.cover_image,
            category_id=c.category_id, exam_id=c.exam_id, status=c.status,
            created_by=c.created_by, created_at=c.created_at, updated_at=c.updated_at,
            videos=[VideoOut.model_validate(v) for v in videos],
            video_count=len(videos),
        ))
    return result


@router.post("/courses", response_model=CourseOut)
def create_course(data: CourseCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    course = Course(
        id=str(uuid.uuid4()),
        title=data.title, description=data.description, cover_image=data.cover_image,
        category_id=data.category_id, exam_id=data.exam_id,
        created_by=current_user.id,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return CourseOut(
        id=course.id, title=course.title, description=course.description,
        cover_image=course.cover_image, category_id=course.category_id,
        exam_id=course.exam_id, status=course.status,
        created_by=course.created_by, created_at=course.created_at,
        updated_at=course.updated_at, videos=[], video_count=0,
    )


@router.get("/courses/{course_id}", response_model=CourseOut)
def get_course(course_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    videos = db.query(Video).filter(Video.course_id == course_id).order_by(Video.sort_order).all()
    return CourseOut(
        id=course.id, title=course.title, description=course.description,
        cover_image=course.cover_image, category_id=course.category_id,
        exam_id=course.exam_id, status=course.status,
        created_by=course.created_by, created_at=course.created_at,
        updated_at=course.updated_at,
        videos=[VideoOut.model_validate(v) for v in videos],
        video_count=len(videos),
    )


@router.put("/courses/{course_id}", response_model=CourseOut)
def update_course(course_id: str, data: CourseUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    videos = db.query(Video).filter(Video.course_id == course_id).order_by(Video.sort_order).all()
    return CourseOut(
        id=course.id, title=course.title, description=course.description,
        cover_image=course.cover_image, category_id=course.category_id,
        exam_id=course.exam_id, status=course.status,
        created_by=course.created_by, created_at=course.created_at,
        updated_at=course.updated_at,
        videos=[VideoOut.model_validate(v) for v in videos],
        video_count=len(videos),
    )


@router.delete("/courses/{course_id}")
def delete_course(course_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    db.query(Video).filter(Video.course_id == course_id).delete()
    db.delete(course)
    db.commit()
    return {"ok": True}


# ========== 视频章节 ==========

@router.post("/courses/{course_id}/videos", response_model=VideoOut)
def add_video(course_id: str, data: VideoCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    max_order = db.query(Video).filter(Video.course_id == course_id).count()
    video = Video(
        id=str(uuid.uuid4()),
        course_id=course_id, title=data.title, obs_key=data.obs_key,
        file_size=data.file_size, duration=data.duration,
        sort_order=max_order,
    )
    db.add(video)
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
    # 获取分配给该用户或其部门的课程
    assignments = (
        db.query(CourseAssignment)
        .filter(
            (CourseAssignment.user_id == current_user.id)
            | (CourseAssignment.department_id == current_user.department)
        )
        .all()
    )
    course_ids = list(set(a.course_id for a in assignments))
    courses = (
        db.query(Course)
        .filter(Course.id.in_(course_ids), Course.status == "published")
        .order_by(Course.created_at.desc())
        .all()
    )
    result = []
    for c in courses:
        videos = db.query(Video).filter(Video.course_id == c.id).order_by(Video.sort_order).all()
        result.append(CourseOut(
            id=c.id, title=c.title, description=c.description, cover_image=c.cover_image,
            category_id=c.category_id, exam_id=c.exam_id, status=c.status,
            created_by=c.created_by, created_at=c.created_at, updated_at=c.updated_at,
            videos=[VideoOut.model_validate(v) for v in videos],
            video_count=len(videos),
        ))
    return result

# ========== 课程分配 ==========

from pydantic import BaseModel


class AssignRequest(BaseModel):
    user_ids: list[str] = []
    department_ids: list[str] = []


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
