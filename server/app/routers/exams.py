"""考试管理路由"""

import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.exam import Exam, ExamPaper, ExamResult
from app.models.paper import Paper
from app.schemas.exam import ExamCreate, ExamUpdate, ExamOut, PaperCreate, PaperOut
from app.routers.auth import require_admin
from app.services.log_service import write_log
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["考试管理"])


# ========== 考试 CRUD ==========

@router.get("/exams", response_model=list[ExamOut])
def list_exams(
    response: Response,
    course_id: str | None = Query(None),
    status: str | None = Query(None),
    page: int | None = Query(None, ge=1, description="页码（不传则返回全部，保持向后兼容）"),
    page_size: int | None = Query(None, ge=1, le=500, description="每页数量"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取考试列表。

    新增可选分页：传入 page/page_size 时按页返回，并通过 `X-Total-Count` 响应头
    返回总数；不传时保持原有「返回全部」行为，兼容现有前端。
    """
    q = db.query(Exam)
    if course_id:
        q = q.filter(Exam.course_id == course_id)
    if status:
        q = q.filter(Exam.status == status)

    q = q.order_by(Exam.created_at.desc())
    if page and page_size:
        response.headers["X-Total-Count"] = str(q.count())
        return q.offset((page - 1) * page_size).limit(page_size).all()
    return q.all()


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
        status=data.status,
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

    # 将考试关联到课程，学员端通过 course.exam_id 看到考试。
    # 数据模型是课程↔考试 1:1；若该课程原先绑定的是另一个考试，把旧考试自动置为
    # 「已结束」，避免它继续以「已发布」状态存在却无法被学员访问（原来的静默覆盖
    # 会让旧考试变成没人知道的孤儿）。
    previous_exam_id = course.exam_id
    if previous_exam_id and previous_exam_id != exam.id:
        previous = db.query(Exam).filter(Exam.id == previous_exam_id).first()
        if previous and previous.status != "ended":
            previous.status = "ended"
            logger.warning(
                "课程「%s」的考试绑定已由「%s」替换为「%s」，旧考试自动置为已结束",
                course.title, previous.title, exam.title,
            )
    course.exam_id = exam.id

    db.commit()
    db.refresh(exam)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="exam", action="create", resource_type="考试", resource_name=exam.title if hasattr(exam, 'title') else "", description=f"{current_user.name} 创建了考试「{exam.title}」", level="info")
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
    current_user: User = Depends(require_admin),
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="exam", action="update", resource_type="考试", resource_name=exam.title if hasattr(exam, 'title') else "", description=f"{current_user.name} 编辑了考试「{exam.title}」", level="info")
    return exam


@router.delete("/exams/{exam_id}")
def delete_exam(
    exam_id: str,
    confirm: bool = Query(False, description="必须显式传 true 才执行删除"),
    force: bool = Query(False, description="已有学员作答记录时，需再传 force=true 才会连历史成绩一并删除"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除考试。

    修复（防误删 + 保护历史）：
    - 必须显式 `confirm=true`
    - 若已有学员作答记录，默认**拒绝删除**（返回 409），
      请改为把考试状态置为 `ended`（结束）以保留成绩；确实要连成绩一起删，再传 `force=true`
    """
    if not confirm:
        raise HTTPException(status_code=400, detail="删除考试需要显式确认（confirm=true）")

    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    result_count = db.query(ExamResult).filter(ExamResult.exam_id == exam_id).count()
    if result_count and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"该考试已有 {result_count} 条学员作答记录，为避免误删历史成绩已阻止删除。"
                "如只想停止考试，请把状态改为「已结束」；如确认要连成绩一并删除，请传 force=true。"
            ),
        )

    title = exam.title
    # 清理课程关联
    db.query(Course).filter(Course.exam_id == exam_id).update(
        {"exam_id": None}, synchronize_session=False
    )

    db.query(ExamResult).filter(ExamResult.exam_id == exam_id).delete()
    db.query(ExamPaper).filter(ExamPaper.exam_id == exam_id).delete()
    db.delete(exam)
    db.commit()
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="exam", action="delete", resource_type="考试", resource_name=title, description=f"{current_user.name} 删除了考试「{title}」", level="warning")
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