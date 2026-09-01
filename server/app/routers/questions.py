"""题库管理路由"""

import uuid
import io
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel
from app.database import get_db
from app.models.user import User
from app.models.question import Question
from app.schemas.question import QuestionCreate, QuestionUpdate, QuestionOut
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["题库管理"])


@router.get("/questions", response_model=list[QuestionOut])
def list_questions(
    type: str | None = Query(None, description="题型筛选"),
    difficulty: str | None = Query(None, description="难度筛选"),
    category_id: str | None = Query(None, description="分类筛选"),
    search: str | None = Query(None, description="搜索题干"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(Question)
    if type:
        q = q.filter(Question.type == type)
    if difficulty:
        q = q.filter(Question.difficulty == difficulty)
    if category_id:
        q = q.filter(Question.category_id == category_id)
    if search:
        q = q.filter(Question.stem.contains(search))
    return q.order_by(Question.created_at.desc()).all()


@router.post("/questions", response_model=QuestionOut, status_code=201)
def create_question(
    data: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # 校验选择题必须有 options
    if data.type in ("single_choice", "multi_choice") and not data.options:
        raise HTTPException(status_code=400, detail="选择题必须提供选项")
    question = Question(
        id=str(uuid.uuid4()),
        type=data.type,
        stem=data.stem,
        options=data.options,
        answer=data.answer,
        keywords=data.keywords,
        difficulty=data.difficulty,
        tags=data.tags,
        section=data.section,
        category_id=data.category_id,
        created_by=current_user.id,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


# ========== 批量操作 ==========

class BatchRequest(BaseModel):
    ids: list[str]
    action: str  # update_difficulty / add_tags / delete
    value: str | list[str] | None = None


@router.post("/questions/batch")
def batch_operation(
    data: BatchRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """批量操作：修改难度、追加标签、删除"""
    questions = db.query(Question).filter(Question.id.in_(data.ids)).all()
    if not questions:
        raise HTTPException(status_code=404, detail="未找到试题")

    if data.action == "update_difficulty":
        if not data.value or data.value not in ("easy", "medium", "hard"):
            raise HTTPException(status_code=400, detail="无效的难度值")
        for q in questions:
            q.difficulty = data.value

    elif data.action == "add_tags":
        if not data.value:
            raise HTTPException(status_code=400, detail="标签不能为空")
        new_tags = data.value if isinstance(data.value, list) else [data.value]
        for q in questions:
            existing = set(q.tags or [])
            existing.update(new_tags)
            q.tags = list(existing)

    elif data.action == "delete":
        for q in questions:
            db.delete(q)

    else:
        raise HTTPException(status_code=400, detail=f"未知操作: {data.action}")

    db.commit()
    return {"ok": True, "affected": len(questions)}


# ========== 导入导出 ==========

TYPE_MAP = {
    "单选题": "single_choice", "single_choice": "单选题",
    "多选题": "multi_choice", "multi_choice": "多选题",
    "判断题": "true_false", "true_false": "判断题",
    "填空题": "fill_blank", "fill_blank": "填空题",
    "问答题": "essay", "essay": "问答题",
}


@router.get("/questions/export")
def export_questions(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """导出题库为 Excel"""
    questions = db.query(Question).order_by(Question.created_at.desc()).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "题库"

    # 表头
    headers = ["题型", "题干", "选项A", "选项B", "选项C", "选项D", "正确答案", "关键词", "难度", "标签", "章节"]
    ws.append(headers)

    for q in questions:
        options = q.options or {}
        answer = q.answer or {}
        row = [
            TYPE_MAP.get(q.type, q.type),
            q.stem,
            options.get("A", ""),
            options.get("B", ""),
            options.get("C", ""),
            options.get("D", ""),
            _format_answer(q.type, answer),
            ",".join(q.keywords) if q.keywords else "",
            q.difficulty,
            ",".join(q.tags) if q.tags else "",
            q.section or "",
        ]
        ws.append(row)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=questions.xlsx"},
    )


def _format_answer(q_type: str, answer: dict) -> str:
    """格式化答案用于 Excel 导出"""
    if q_type == "single_choice":
        return str(answer.get("correct", ""))
    elif q_type == "multi_choice":
        correct = answer.get("correct", [])
        return ",".join(correct) if isinstance(correct, list) else str(correct)
    elif q_type == "true_false":
        return "true" if answer.get("correct") else "false"
    elif q_type == "fill_blank":
        return str(answer.get("correct", ""))
    elif q_type == "essay":
        return ""  # 问答题答案不导出
    return ""


@router.post("/questions/import")
async def import_questions(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """从 Excel 导入题库"""
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 或 .xls 格式")

    contents = await file.read()
    wb = load_workbook(io.BytesIO(contents))
    ws = wb.active

    created = 0
    skipped = 0
    errors = []

    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row[0] or not row[1]:  # 题型和题干必填
            continue

        try:
            q_type_cn = str(row[0]).strip()
            q_type_en = {v: k for k, v in TYPE_MAP.items()}.get(q_type_cn)
            if not q_type_en:
                errors.append(f"第{i}行: 无效题型 '{q_type_cn}'")
                continue

            stem = str(row[1]).strip()

            # 重复检测
            existing = db.query(Question).filter(Question.stem == stem).first()
            if existing:
                skipped += 1
                continue

            # 选项
            options = None
            if q_type_en in ("single_choice", "multi_choice"):
                options = {}
                option_labels = ["A", "B", "C", "D"]
                for j, label in enumerate(option_labels):
                    if row[2 + j] and str(row[2 + j]).strip():
                        options[label] = str(row[2 + j]).strip()

            # 答案
            answer_str = str(row[6]).strip() if row[6] else ""
            answer = _parse_answer(q_type_en, answer_str)

            # 关键词
            keywords = None
            if row[7] and str(row[7]).strip():
                keywords = [k.strip() for k in str(row[7]).split(",") if k.strip()]

            # 难度
            difficulty = str(row[8]).strip() if row[8] else "medium"
            if difficulty not in ("easy", "medium", "hard"):
                difficulty = "medium"

            # 标签
            tags = None
            if row[9] and str(row[9]).strip():
                tags = [t.strip() for t in str(row[9]).split(",") if t.strip()]

            # 章节
            section = str(row[10]).strip() if len(row) > 10 and row[10] else None

            question = Question(
                id=str(uuid.uuid4()),
                type=q_type_en,
                stem=stem,
                options=options,
                answer=answer,
                keywords=keywords,
                difficulty=difficulty,
                tags=tags,
                section=section,
                created_by=current_user.id,
            )
            db.add(question)
            created += 1

        except Exception as e:
            errors.append(f"第{i}行: {str(e)}")

    db.commit()

    return {"created": created, "skipped": skipped, "errors": errors}


# ========== 单题操作 ==========

@router.get("/questions/{question_id}", response_model=QuestionOut)
def get_question(
    question_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    question = db.query(Question).filter(Question.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="试题不存在")
    return question


@router.put("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: str,
    data: QuestionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    question = db.query(Question).filter(Question.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="试题不存在")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/questions/{question_id}")
def delete_question(
    question_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    question = db.query(Question).filter(Question.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="试题不存在")
    db.delete(question)
    db.commit()
    return {"ok": True}


def _parse_answer(q_type: str, answer_str: str) -> dict:
    """解析 Excel 中的答案字符串"""
    if q_type == "single_choice":
        return {"correct": answer_str}
    elif q_type == "multi_choice":
        return {"correct": [a.strip() for a in answer_str.split(",") if a.strip()]}
    elif q_type == "true_false":
        return {"correct": answer_str.lower() == "true"}
    elif q_type == "fill_blank":
        return {"correct": answer_str}
    elif q_type == "essay":
        return {"reference": answer_str}
    return {"correct": answer_str}