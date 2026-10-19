"""全员名册同步服务

从招聘系统 recruitment_db.org_members 全量拉取员工快照，镜像到本库
org_members 表，并把平台账号（users.employee_id 软匹配）融合标注后
输出给「用户管理」融合视图。

设计原则：
- 镜像表纯展示，无外键、不参与业务；同步绝不碰 departments / users。
- 源库连接运行时惰性推导（同实例零配置），不可达只影响同步动作。
- 全量替换走单事务 + 防误清守卫（空源/骤降拒绝），失败保留旧镜像。
"""

from __future__ import annotations

import threading
from datetime import datetime

from sqlalchemy import URL, create_engine, insert, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.config import settings
from app.models.org_member import OrgMember, OrgSyncMeta
from app.models.user import User
from app.services.log_service import write_log

# 源不可达（连接失败/源表缺失/查询异常）
class OrgSourceUnavailable(Exception):
    pass


# 防误清守卫拦截
class SyncGuardRejected(Exception):
    pass


# 并发同步拦截（409）
class SyncInProgress(Exception):
    pass


_sync_lock = threading.Lock()
_source_engine: Engine | None = None


def _source_url() -> str:
    """源库连接串：显式 ORG_SOURCE_DB_URL 优先，否则用本库分量换库名推导。"""
    if settings.ORG_SOURCE_DB_URL:
        return settings.ORG_SOURCE_DB_URL
    return URL.create(
        "mysql+pymysql",
        username=settings.DB_USER,
        password=settings.DB_PASSWORD,
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        database=settings.ORG_SOURCE_DB_NAME,
    ).render_as_string(hide_password=False)


def _get_source_engine() -> Engine:
    """惰性单例。仅在同步动作发生时才真正建连，import 期零副作用。"""
    global _source_engine
    if _source_engine is None:
        _source_engine = create_engine(
            _source_url(),
            pool_size=1,
            max_overflow=0,
            pool_pre_ping=True,
            connect_args={"connect_timeout": settings.ORG_SOURCE_CONNECT_TIMEOUT},
        )
    return _source_engine


def fetch_source_rows() -> list[dict]:
    """全量拉取源表。抽出为独立函数便于测试 monkeypatch。"""
    sql = (
        "SELECT emp_id, name, position, dept_path, top_dept, supervisor_id, "
        "seq, imported_at FROM org_members ORDER BY seq"
    )
    try:
        engine = _get_source_engine()
        with engine.connect() as conn:
            result = conn.exec_driver_sql(sql)
            cols = list(result.keys())
            rows = [dict(zip(cols, r)) for r in result.fetchall()]
    except OrgSourceUnavailable:
        raise
    except Exception as e:  # 连接失败、源表不存在等，统一收敛
        raise OrgSourceUnavailable(f"无法连接组织架构数据源：{type(e).__name__}: {e}") from e

    # top_dept 缺失时按 dept_path 首段补齐
    for r in rows:
        if not r.get("top_dept") and r.get("dept_path"):
            r["top_dept"] = r["dept_path"].split(">")[0].strip()
        if r.get("seq") is None:
            r["seq"] = 0
    return rows


def sync_all(db: Session, operator: User) -> dict:
    """全量替换镜像表。成功返回统计；失败不动镜像，抛受控异常。"""
    if not _sync_lock.acquire(blocking=False):
        raise SyncInProgress("已有同步任务正在进行，请稍后再试")
    try:
        rows = fetch_source_rows()

        # ---- 防误清守卫 ----
        existing = db.query(OrgMember).count()
        if not rows:
            raise SyncGuardRejected("数据源返回 0 行，为避免清空本地名册已拒绝本次同步")
        if existing and len(rows) < existing * 0.5:
            raise SyncGuardRejected(
                f"数据源仅 {len(rows)} 行，较本地名册（{existing} 行）骤降超过 50%，已拒绝本次同步"
            )

        # ---- 单事务全量替换 ----
        synced_at = datetime.now()
        source_imported_at = max(
            (r["imported_at"] for r in rows if r.get("imported_at")), default=None
        )
        try:
            db.query(OrgMember).delete(synchronize_session=False)
            for i in range(0, len(rows), 1000):
                db.execute(insert(OrgMember), rows[i : i + 1000])
            meta = db.get(OrgSyncMeta, 1)
            if meta is None:
                meta = OrgSyncMeta(id=1)
                db.add(meta)
            meta.synced_at = synced_at
            meta.row_count = len(rows)
            meta.source_imported_at = source_imported_at
            db.commit()
        except Exception:
            db.rollback()
            raise

        write_log(
            db=db,
            operator=operator.name,
            operator_id=operator.id,
            category="user",
            action="sync",
            resource_type="组织架构",
            description=f"{operator.name} 同步全员名册：共 {len(rows)} 人（原 {existing} 人）",
            detail={"imported": len(rows), "previous": existing},
            level="info",
        )
        return {
            "imported": len(rows),
            "previous": existing,
            "synced_at": synced_at,
            "source_imported_at": source_imported_at,
        }
    finally:
        _sync_lock.release()


def _iso(dt) -> str | None:
    return dt.isoformat(sep=" ", timespec="seconds") if dt else None


def build_fused_payload(db: Session) -> dict:
    """镜像全员 + 平台账号融合标注（2 条 SQL，内存匹配，无 N+1）。

    匹配规则（集中在此一处定义，前端不再各自实现）：
    - users.employee_id 去首尾空白后与 org_members.emp_id 精确相等；
    - 空/NULL 工号、或工号不在名册中的账号 → 计入 unlinked_account_count，
      前端提供「不在名册的账号」筛选项兜底，保证这些账号仍可管理；
    - 同工号多账号 → 主账号取「启用态优先、其次创建时间最新」，
      account_count 返回实际数量供前端显 ×N 角标。
    """
    members = db.scalars(select(OrgMember).order_by(OrgMember.seq)).all()
    accounts = db.execute(
        select(
            User.id, User.username, User.name, User.employee_id,
            User.department, User.role, User.status, User.created_at,
        )
    ).all()

    by_emp: dict[str, list] = {}
    empty_emp_accounts = 0
    for a in accounts:
        emp = (a.employee_id or "").strip()
        if not emp:
            empty_emp_accounts += 1
            continue
        by_emp.setdefault(emp, []).append(a)

    def pick_primary(lst: list):
        active = [u for u in lst if u.status == "active"]
        pool = active or lst
        return max(pool, key=lambda u: u.created_at or datetime.min)

    member_emp_ids = {m.emp_id for m in members}
    unlinked_count = empty_emp_accounts + sum(
        len(lst) for emp, lst in by_emp.items() if emp not in member_emp_ids
    )

    out_members = []
    for m in members:
        lst = by_emp.get(m.emp_id, [])
        if lst:
            p = pick_primary(lst)
            account = {
                "user_id": p.id,
                "username": p.username,
                "name": p.name,
                "employee_id": p.employee_id,
                "department": p.department,
                "role": p.role,
                "status": p.status,
            }
        else:
            account = None
        out_members.append(
            {
                "emp_id": m.emp_id,
                "name": m.name,
                "position": m.position,
                "dept_path": m.dept_path,
                "top_dept": m.top_dept,
                "account": account,
                "account_count": len(lst),
            }
        )

    meta_row = db.get(OrgSyncMeta, 1)
    meta = None
    if meta_row is not None:
        meta = {
            "synced_at": _iso(meta_row.synced_at),
            "row_count": meta_row.row_count,
            "source_imported_at": _iso(meta_row.source_imported_at),
            "unlinked_account_count": unlinked_count,
        }
    return {"meta": meta, "members": out_members}


def list_unlinked_accounts(db: Session) -> list[dict]:
    """不在名册中的平台账号（工号为空 / 工号不在镜像 emp_id 集合）。

    供融合视图「不在名册的账号」筛选项使用，返回与 members 同构的行，
    dept_path 用平台 accounts.department 文本（仅兜底展示）。
    """
    member_emp_ids = set(db.scalars(select(OrgMember.emp_id)).all())
    rows = db.execute(
        select(
            User.id, User.username, User.name, User.employee_id,
            User.department, User.role, User.status, User.created_at,
        )
    ).all()
    out = []
    for a in rows:
        emp = (a.employee_id or "").strip()
        if emp and emp in member_emp_ids:
            continue
        out.append(
            {
                "emp_id": None,
                "user_id": a.id,
                "name": a.name,
                "username": a.username,
                "employee_id": a.employee_id,
                "position": None,
                "dept_path": None,
                "department": a.department,
                "top_dept": None,
                "account": {
                    "user_id": a.id,
                    "username": a.username,
                    "name": a.name,
                    "employee_id": a.employee_id,
                    "department": a.department,
                    "role": a.role,
                    "status": a.status,
                },
                "account_count": 1,
                "unlinked": True,
            }
        )
    return out
