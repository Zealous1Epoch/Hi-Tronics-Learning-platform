"""用户管理路由"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut, UserUpdateRole, UserCreate
from app.routers.auth import get_current_user, require_admin
from app.services.auth_service import hash_password


class UserUpdateStatus(BaseModel):
    status: str

router = APIRouter(prefix="/api/users", tags=["用户管理"])


@router.get("", response_model=list[UserOut])
def list_users(
    search: str | None = Query(None, description="搜索姓名/用户名/工号"),
    role: str | None = Query(None, description="筛选角色"),
    status: str | None = Query(None, description="筛选状态"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取用户列表"""
    q = db.query(User)
    if search:
        q = q.filter(
            User.name.contains(search)
            | User.username.contains(search)
            | User.employee_id.contains(search)
        )
    if role:
        q = q.filter(User.role == role)
    if status:
        q = q.filter(User.status == status)
    return q.order_by(User.created_at.desc()).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """创建用户"""
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        name=data.name,
        employee_id=data.employee_id,
        department=data.department,
        role=data.role,
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: str,
    data: UserUpdateRole,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """提升/撤销管理员角色"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if data.role not in ("student", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色无效")
    user.role = data.role
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/status", response_model=UserOut)
def update_user_status(
    user_id: str,
    data: UserUpdateStatus,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """启用/禁用用户"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if data.status not in ("active", "disabled"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="状态无效")
    user.status = data.status
    db.commit()
    db.refresh(user)
    return user