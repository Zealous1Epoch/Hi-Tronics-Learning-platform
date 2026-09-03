"""考试管理路由"""

import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.exam import Exam, ExamPaper, ExamResult
from app.models.paper import Paper
from app.schemas.exam import ExamCreate, ExamUpdate, ExamOut, PaperCreate, PaperOut
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["考试管理"])


# ========== 考试 CRUD ==========

@router.get("/exams", response_model=list[ExamOut])
def list_exams(
    course_id: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(Exam)
    if course_id:
        q = q.filter(Exam.course_id == course_id)
    if status:
        q = q.filter(Exam.status == status)
    return q.order_by(Exam.created_at.desc()).all()


@router.post("/exams", response_model=ExamOut, status_code=201)
def create_exam(
    data: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # 验证课程存在
    course = db.query(Course).filter(Course.id == data.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")

    # 如果关联了试卷，读取试卷数据
    paper = None
    if data.paper_id:
        paper = db.query(Paper).filter(Paper.id == data.paper_id).first()
        if not paper:
            raise HTTPException(status_code=404, detail="试卷不存在")

    start_time = datetime.fromisoformat(data.start_time) if data.start_time else None
    end_time = datetime.fromisoformat(data.end_time) if data.end_time else None

    exam = Exam(
        id=str(uuid.uuid4()),
        course_id=data.course_id,
        title=data.title,
        paper_type=data.paper_type,
        paper_id=data.paper_id,
        duration=data.duration,
        total_score=data.total_score,
        pass_score=data.pass_score,
        max_attempts=data.max_attempts,
        start_time=start_time,
        end_time=end_time,
        created_by=current_user.id,
    )
    db.add(exam)
    db.flush()  # 获取 exam.id，但暂不提交

    # 从试卷复制组卷内容到 exam_papers
    if paper:
        exam_paper = ExamPaper(
            id=str(uuid.uuid4()),
            exam_id=exam.id,
            questions=paper.mandatory_questions,
            random_rules=paper.random_rules,
        )
        db.add(exam_paper)

    # 将考试关联到课程，学员端通过 course.exam_id 看到考试
    course.exam_id = exam.id

    db.commit()
    db.refresh(exam)
    return exam


@router.get("/exams/{exam_id}", response_model=ExamOut)
def get_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    return exam


@router.put("/exams/{exam_id}", response_model=ExamOut)
def update_exam(
    exam_id: str,
    data: ExamUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    update_data = data.model_dump(exclude_unset=True)
    # 处理时间字段
    for field in ("start_time", "end_time"):
        if field in update_data and update_data[field] is not None:
            update_data[field] = datetime.fromisoformat(update_data[field])
    for field, value in update_data.items():
        setattr(exam, field, value)
    db.commit()
    db.refresh(exam)
    return exam


@router.delete("/exams/{exam_id}")
def delete_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    # 清理课程关联
    db.query(Course).filter(Course.exam_id == exam_id).update({"exam_id": None})

    db.query(ExamResult).filter(ExamResult.exam_id == exam_id).delete()
    db.query(ExamPaper).filter(ExamPaper.exam_id == exam_id).delete()
    db.delete(exam)
    db.commit()
    return {"ok": True}


# ========== 组卷 ==========

@router.get("/exams/{exam_id}/paper", response_model=PaperOut)
def get_paper(
    exam_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    paper = db.query(ExamPaper).filter(ExamPaper.exam_id == exam_id).first()
    if not paper:
        return PaperOut(id="", exam_id=exam_id, questions=None, random_rules=None)
    return paper


@router.post("/exams/{exam_id}/paper", response_model=PaperOut)
def save_paper(
    exam_id: str,
    data: PaperCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    # 删除旧试卷
    db.query(ExamPaper).filter(ExamPaper.exam_id == exam_id).delete()

    questions = [q.model_dump() for q in data.questions] if data.questions else None
    random_rules = [r.model_dump() for r in data.random_rules] if data.random_rules else None

    paper = ExamPaper(
        id=str(uuid.uuid4()),
        exam_id=exam_id,
        questions=questions,
        random_rules=random_rules,
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)
    return paper