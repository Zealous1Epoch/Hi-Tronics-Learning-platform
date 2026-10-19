"""组织架构（全员名册镜像）路由

仅管理员可见。数据为招聘系统 recruitment_db.org_members 的本地镜像，
通过「同步全员」按钮手动全量刷新；页面浏览只依赖本地镜像，源不可达不影响。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
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


@router.post("/sync")
def trigger_org_sync(
    db: Session = Depends(get_db),
    operator: User = Depends(require_admin),
):
    """从招聘系统全量同步全员名册镜像"""
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
    return provision_all_members(db, operator)


@router.get("/members")
def get_org_members(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """全员名册（镜像）+ 平台账号融合标注，一次全量返回。

    meta 为 null 表示从未同步；unlinked_accounts 是工号为空或不在名册中的
    平台账号，保证它们在用户管理页仍能被管理。
    """
    payload = build_fused_payload(db)
    payload["unlinked_accounts"] = list_unlinked_accounts(db)
    return payload
