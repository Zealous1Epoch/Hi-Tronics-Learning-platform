"""公告通知路由"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user, require_admin
from app.schemas.notice import (
    NoticeCreate,
    NoticeUpdate,
    NoticeAdminResponse,
    NoticeStudentResponse,
    UnreadCountResponse,
    NoticeListResponse,
)
from app.services.notice_service import (
    create_notice,
    update_notice,
    delete_notice,
    get_notices,
    get_published_notices,
    get_unread_count,
    mark_as_read,
)

router = APIRouter(prefix="/api/notices", tags=["公告通知"])


# ── 管理端接口 ──


@router.post("", response_model=NoticeAdminResponse, status_code=status.HTTP_201_CREATED)
def api_create_notice(
    data: NoticeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """创建公告"""
    notice = create_notice(db, current_user.id, current_user.name, data)
    return _to_admin_response(db, notice)


@router.put("/{notice_id}", response_model=NoticeAdminResponse)
def api_update_notice(
    notice_id: str,
    data: NoticeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """编辑公告"""
    notice = update_notice(db, notice_id, current_user.name, data)
    if not notice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="公告不存在")
    return _to_admin_response(db, notice)


@router.delete("/{notice_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_notice(
    notice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除公告"""
    if not delete_notice(db, notice_id, current_user.name):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="公告不存在")


@router.get("")
def api_get_notices(
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """获取公告列表（管理端，含已读统计）"""
    notices, total = get_notices(db, status_filter, page, page_size)
    return NoticeListResponse(
        notices=notices,
        total=total,
    )


# ── 学员端接口 ──


@router.get("/published")
def api_get_published_notices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取已发布公告列表（学员端，含是否已读）"""
    notices = get_published_notices(db, current_user.id)
    return NoticeListResponse(
        notices=notices,
        total=len(notices),
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
def api_get_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取未读公告数"""
    count = get_unread_count(db, current_user.id)
    return UnreadCountResponse(unread_count=count)


@router.post("/{notice_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def api_mark_as_read(
    notice_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """标记公告为已读"""
    if not mark_as_read(db, notice_id, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="公告不存在或未发布")


# ── 辅助函数 ──


def _to_admin_response(db: Session, notice) -> NoticeAdminResponse:
    """将 Notice ORM 转为 NoticeAdminResponse"""
    from sqlalchemy import func
    from app.models.notice import NoticeRead
    from app.models.user import User

    read_count = db.query(func.count(NoticeRead.id)).filter(
        NoticeRead.notice_id == notice.id
    ).scalar() or 0
    total_users = db.query(func.count(User.id)).filter(
        User.role == "student", User.status == "active"
    ).scalar() or 0

    return NoticeAdminResponse(
        id=notice.id,
        title=notice.title,
        content=notice.content,
        author_id=notice.author_id,
        status=notice.status,
        is_pinned=notice.is_pinned,
        created_at=notice.created_at,
        updated_at=notice.updated_at,
        read_count=read_count,
        total_users=total_users,
    )