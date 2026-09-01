"""种子数据：创建内置管理员账号"""

import uuid
from sqlalchemy.orm import Session
from app.models.user import User
from app.services.auth_service import hash_password
from app.config import settings


def seed_builtin_admin(db: Session):
    """创建内置管理员账号（如果不存在）"""
    existing = db.query(User).filter(User.username == settings.BUILTIN_ADMIN_USERNAME).first()
    if existing:
        return

    # 生产环境必须通过环境变量 ADMIN_PASSWORD 设置密码
    password = settings.BUILTIN_ADMIN_PASSWORD
    if not password:
        print("[WARNING] ADMIN_PASSWORD 未设置，使用默认密码")
        password = "Ht12345!"

    admin = User(
        id=str(uuid.uuid4()),
        username=settings.BUILTIN_ADMIN_USERNAME,
        password_hash=hash_password(password),
        name="系统管理员",
        role="admin",
        status="active",
    )
    db.add(admin)
    db.commit()