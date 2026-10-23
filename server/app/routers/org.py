"""组织架构（全员名册镜像）路由

仅管理员可见。数据为招聘系统 recruitment_db.org_members 的本地镜像，
通过「同步全员」按钮手动全量刷新；页面浏览只依赖本地镜像，源不可达不影响。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.routers.auth import require_admin
from app.services.org_sync import (
    OrgSourceUnavailable,
    SyncGuardRejected,
    SyncInProgress,
    build_fused_payload,
    list_unlinked_accounts,
    provision_all_members,
    sync_all,
)

router = APIRouter(prefix="/api/org", tags=["组织架构"])


def _ensure_sync_enabled() -> None:
    """名册导入闸门（ORG_SYNC_ENABLED=false 时禁用 HR 名册导入与批量开通）。

    生产在确认「导入全公司名册」之前保持关闭；融合视图本身不受影响
    （空镜像时后端自动以平台账号为名册返回）。
    """
    if not settings.ORG_SYNC_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="名册同步/批量开通功能未启用（ORG_SYNC_ENABLED=false），"
                   "如需导入全公司名册请在服务端开启后重启",
        )


@router.post("/sync")
def trigger_org_sync(
    db: Session = Depends(get_db),
    operator: User = Depends(require_admin),
):
    """从招聘系统全量同步全员名册镜像"""
    _ensure_sync_enabled()
    try:
        return sync_all(db, operator)
    except SyncInProgress as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except SyncGuardRejected as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except OrgSourceUnavailable as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"组织架构数据源不可达，本地名册保持上一次同步结果不变。{e}",
        )


@router.post("/provision")
def provision_org_accounts(
    db: Session = Depends(get_db),
    operator: User = Depends(require_admin),
):
    """为名册全员批量开通无密码账号（幂等，可重复执行）。

    username=工号、student、password_hash=None——只能经 OA/企微 SSO 进入，
    密码登录路径 fail-closed。已开户者跳过；返回统计供前端 toast。
    """
    _ensure_sync_enabled()
    return provision_all_members(db, operator)


@router.get("/members")
def get_org_members(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """全员名册（镜像）+ 平台账号融合标注，一次全量返回。

    meta 为 null 表示从未同步——此时后端退化为「平台账号即名册」模式
    （fallback），unlinked_accounts 恒为空，前端融合视图与选人组件
    直接用 members 即可，不会重复显示；HR 名册同步后自动恢复
    「镜像 + 不在名册的账号」两栏模式。
    """
    payload = build_fused_payload(db)
    if payload.pop("fallback", False):
        payload["unlinked_accounts"] = []
    else:
        payload["unlinked_accounts"] = list_unlinked_accounts(db)
    return payload
