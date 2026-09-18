"""部门同步服务：将 SSO 登录时的部门路径自动同步到 Department 树"""

from sqlalchemy.orm import Session
from app.models.department import Department
from app.logger import get_logger

logger = get_logger(__name__)


def ensure_department_path(db: Session, path: str) -> Department | None:
    """将部门路径（如"IT部-开发组"）解析并同步到 Department 树。

    按 "-" 切割为逐级节点，从上到下查找/创建：
      - 节点已存在 → 复用
      - 节点不存在 → 自动创建

    Args:
        db: 数据库 session
        path: 部门路径字符串，如 "IT部-开发组"

    Returns:
        叶子节点 Department，path 为空或解析失败时返回 None
    """
    if not path or not path.strip():
        return None

    segments = [s.strip() for s in path.split("-") if s.strip()]
    if not segments:
        return None

    parent_id: str | None = None
    leaf: Department | None = None

    for name in segments:
        # 在当前级别查找
        dept = db.query(Department).filter(
            Department.name == name,
            Department.parent_id == parent_id,
        ).first()

        if not dept:
            dept = Department(name=name, parent_id=parent_id)
            db.add(dept)
            db.flush()
            logger.info("自动创建部门: name=%s, parent_id=%s", name, parent_id)

        parent_id = dept.id
        leaf = dept

    return leaf