"""AI 出题路由

fail-closed：未配置 LLM_API_KEY 时 /generate 返回 503（与 SSO 无密钥的行为一致），
不影响平台其他功能。生成阶段绝不写业务表——只产出草稿供人工审核，
入库走 POST /questions/bulk-create。
"""

import threading

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.llm.provider import llm_enabled
from app.models.user import User
from app.routers.auth import require_admin
from app.schemas.ai_question import (
    AIGenerateRequest,
    AIGenerateResponse,
    AIParseDocOut,
    AIStatusOut,
)
from app.services.ai_question_service import generate_drafts
from app.services.doc_parse_service import MAX_UPLOAD_BYTES, parse_document
from app.services.log_service import write_log

router = APIRouter(prefix="/api/ai", tags=["AI 出题"])

# 生成请求并发闸门（进程内，单机单 worker 约束下够用，与登录限流同套路）：
# 一次生成持 5 个 LLM 线程 + 最长 100s，且按 token 计费。不限并发的话，
# 十几个并发请求就能耗尽 SQLAlchemy 连接池（默认 5+10）拖垮全站接口。
_MAX_CONCURRENT_GENERATIONS = 2
_generate_gate = threading.BoundedSemaphore(_MAX_CONCURRENT_GENERATIONS)


@router.get("/status", response_model=AIStatusOut)
def ai_status(_: User = Depends(require_admin)):
    """前端据此决定「AI 出题」按钮是否可用/置灰"""
    return {"enabled": llm_enabled(), "model": settings.LLM_MODEL}


@router.post("/parse-document", response_model=AIParseDocOut)
def ai_parse_document(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    """解析参考资料文件为纯文本（PDF/Word/图片/txt/md），不落库。

    合理说明：仅管理端可用；图片 OCR 需服务端配置 LLM_VISION_MODEL，
    其余类型纯本地解析，不依赖 LLM。
    """
    blob = file.file.read(MAX_UPLOAD_BYTES + 1)
    return parse_document(file.filename or "file", blob)


@router.post("/generate", response_model=AIGenerateResponse)
def ai_generate(
    data: AIGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按主题关键词批量生成题目草稿（同步长请求，典型 30-90 秒）。

    只读题库（用于查重标记），不写任何业务表；审计日志记录本次生成行为。
    """
    if not llm_enabled():
        raise HTTPException(status_code=503, detail="AI 功能未启用：服务端未配置 LLM_API_KEY")

    if not _generate_gate.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail=f"同时进行的 AI 生成已达上限（{_MAX_CONCURRENT_GENERATIONS} 个），请等待当前批次完成后再试",
        )
    try:
        # 释放鉴权阶段占用的数据库连接：LLM 等待长达数十秒，session 闲置持有
        # 连接会白白占用连接池（默认 5+10）。稍后查重/写日志时自动重新取用。
        db.close()
        drafts, warnings, meta = generate_drafts(db, data)
    finally:
        _generate_gate.release()

    usage = meta.get("usage") or {}
    write_log(
        db=db,
        operator=current_user.name,
        operator_id=current_user.id,
        category="question",
        action="ai_generate",
        resource_type="试题",
        resource_name=data.topic[:50],
        description=(
            f"{current_user.name} 使用 AI 生成试题草稿：主题「{data.topic[:50]}」，"
            f"请求 {meta['requested']} 题，生成 {meta['generated']} 题，耗时 {meta['elapsed_ms']}ms，"
            f"tokens in={usage.get('prompt_tokens', 0)} out={usage.get('completion_tokens', 0)}"
        ),
        level="info",
    )
    return {"drafts": drafts, "warnings": warnings, "meta": meta}
