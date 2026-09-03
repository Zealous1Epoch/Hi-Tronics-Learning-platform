"""种子数据：创建内置管理员账号"""

import uuid
import sys
from sqlalchemy.orm import Session
from app.models.user import User
from app.services.auth_service import hash_password
from app.config import settings
from app.logger import get_logger

logger = get_logger("seed")


def seed_builtin_admin(db: Session):
    """创建内置管理员账号（如果不存在）"""
    existing = db.query(User).filter(User.username == settings.BUILTIN_ADMIN_USERNAME).first()
    if existing:
        return

    password = settings.BUILTIN_ADMIN_PASSWORD
    if not password:
        if settings.DEBUG:
            logger.warning("ADMIN_PASSWORD 未设置，开发环境使用默认密码")
            password = "Ht12345!"
        else:
            logger.critical("生产环境必须设置 ADMIN_PASSWORD 环境变量")
            sys.exit(1)

    logger.info("创建内置管理员账号: %s", settings.BUILTIN_ADMIN_USERNAME)
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