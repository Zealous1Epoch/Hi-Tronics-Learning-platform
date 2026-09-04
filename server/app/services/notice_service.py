"""公告通知服务"""

import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.notice import Notice, NoticeRead
from app.models.user import User
from app.schemas.notice import (
    NoticeCreate,
    NoticeUpdate,
    NoticeAdminResponse,
    NoticeStudentResponse,
)
from app.services.log_service import write_log


def create_notice(
    db: Session, author_id: str, author_name: str, data: NoticeCreate
) -> Notice:
    """创建公告"""
    notice = Notice(
        id=str(uuid.uuid4()),
        title=data.title,
        content=data.content,
        author_id=author_id,
        status=data.status,
        is_pinned=data.is_pinned,
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)

    write_log(
        db=db,
        operator=author_name,
        operator_id=author_id,
        category="system",
        action="create",
        resource_type="公告",
        resource_name=data.title,
        description=f"创建了公告「{data.title}」",
        level="info",
    )
    return notice


def update_notice(
    db: Session, notice_id: str, operator_name: str, data: NoticeUpdate
) -> Notice | None:
    """编辑公告，返回 None 表示不存在"""
    notice = db.query(Notice).filter(Notice.id == notice_id).first()
    if not notice:
        return None

    old_title = notice.title
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(notice, key, value)

    db.commit()
    db.refresh(notice)

    write_log(
        db=db,
        operator=operator_name,
        category="system",
        action="update",
        resource_type="公告",
        resource_name=notice.title,
        description=f"编辑了公告「{old_title}」",
        level="info",
    )
    return notice


def delete_notice(db: Session, notice_id: str, operator_name: str) -> bool:
    """删除公告，返回是否成功删除"""
    notice = db.query(Notice).filter(Notice.id == notice_id).first()
    if not notice:
        return False

    title = notice.title
    # 删除关联的已读记录
    db.query(NoticeRead).filter(NoticeRead.notice_id == notice_id).delete()
    db.delete(notice)
    db.commit()

    write_log(
        db=db,
        operator=operator_name,
        category="system",
        action="delete",
        resource_type="公告",
        resource_name=title,
        description=f"删除了公告「{title}」",
        level="info",
    )
    return True


def get_notices(
    db: Session, status: str | None = None, page: int = 1, page_size: int = 10
) -> tuple[list[NoticeAdminResponse], int]:
    """获取公告列表（管理端），含已读统计"""
    query = db.query(Notice)
    if status:
        query = query.filter(Notice.status == status)

    total = query.count()
    notices = query.order_by(Notice.is_pinned.desc(), Notice.created_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    total_users = db.query(func.count(User.id)).filter(
        User.role == "student", User.status == "active"
    ).scalar() or 0

    result = []
    for n in notices:
        read_count = db.query(func.count(NoticeRead.id)).filter(
            NoticeRead.notice_id == n.id
        ).scalar() or 0

        result.append(
            NoticeAdminResponse(
                id=n.id,
                title=n.title,
                content=n.content,
                author_id=n.author_id,
                status=n.status,
                is_pinned=n.is_pinned,
                created_at=n.created_at,
                updated_at=n.updated_at,
                read_count=read_count,
                total_users=total_users,
            )
        )

    return result, total


def get_published_notices(
    db: Session, user_id: str
) -> list[NoticeStudentResponse]:
    """获取已发布的公告列表（学员端），含当前用户是否已读"""
    notices = (
        db.query(Notice)
        .filter(Notice.status == "published")
        .order_by(Notice.is_pinned.desc(), Notice.created_at.desc())
        .all()
    )

    result = []
    for n in notices:
        is_read = (
            db.query(NoticeRead)
            .filter(
                NoticeRead.notice_id == n.id,
                NoticeRead.user_id == user_id,
            )
            .first()
            is not None
        )

        result.append(
            NoticeStudentResponse(
                id=n.id,
                title=n.title,
                content=n.content,
                is_pinned=n.is_pinned,
                created_at=n.created_at,
                is_read=is_read,
            )
        )

    return result


def get_unread_count(db: Session, user_id: str) -> int:
    """获取用户的未读公告数"""
    total_published = (
        db.query(func.count(Notice.id))
        .filter(Notice.status == "published")
        .scalar()
        or 0
    )
    read_count = (
        db.query(func.count(NoticeRead.id))
        .filter(NoticeRead.user_id == user_id)
        .scalar()
        or 0
    )
    return max(0, total_published - read_count)


def mark_as_read(db: Session, notice_id: str, user_id: str) -> bool:
    """标记公告为已读，返回是否成功（已存在时返回 False）"""
    # 检查公告是否存在且已发布
    notice = db.query(Notice).filter(
        Notice.id == notice_id,
        Notice.status == "published",
    ).first()
    if not notice:
        return False

    # 检查是否已标记过
    existing = db.query(NoticeRead).filter(
        NoticeRead.notice_id == notice_id,
        NoticeRead.user_id == user_id,
    ).first()
    if existing:
        return True  # 已读过了，不报错

    read = NoticeRead(
        id=str(uuid.uuid4()),
        notice_id=notice_id,
        user_id=user_id,
    )
    db.add(read)
    db.commit()
    return True