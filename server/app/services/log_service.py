"""结构化系统日志服务"""

import uuid
import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.system_log import SystemLog


def write_log(
    db: Session,
    *,
    operator: str,
    operator_id: str | None = None,
    category: str,
    action: str,
    resource_type: str,
    resource_name: str | None = None,
    description: str,
    detail: dict | None = None,
    level: str = "info",
) -> SystemLog:
    """写入一条结构化操作日志"""
    log = SystemLog(
        id=str(uuid.uuid4()),
        operator=operator,
        operator_id=operator_id,
        category=category,
        action=action,
        resource_type=resource_type,
        resource_name=resource_name,
        description=description,
        detail=json.dumps(detail, ensure_ascii=False) if detail else None,
        level=level,
    )
    db.add(log)
    db.commit()
    return log