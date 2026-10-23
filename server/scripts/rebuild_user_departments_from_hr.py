"""按 HR 名册重整平台账号部门归属（2026-10-23 数据治理）

背景：存量账号的 department 是五花八门的文本（班组末级残片、无父级、自创
名目），任何文本都会自动建节点，导致用户管理融合视图的部门树严重碎片化。

本脚本以招聘系统名册（recruitment_db.org_members，同实例只读）的 dept_path
为唯一归类口径：
  1. 只读取 emp_id → dept_path 映射（不落任何人员数据进平台库）；
  2. 平台账号按 TRIM(employee_id) 命中 → ensure_department_path 挂到标准
     部门链，回填 department（'-' 文本，保持既有字段兼容）与 department_id；
  3. 未命中账号一律不动，输出清单交管理员在页面上手动归位；
  4. 清理重整后不再被任何用户/课程/课程分配/子节点引用的碎片部门节点。

用法（默认 dry-run 只报告，确认后加 --apply 落库）：
    cd server && .venv/bin/python scripts/rebuild_user_departments_from_hr.py [--apply]
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select, text

from app.config import settings
from app.database import SessionLocal
from app.models.department import Department
from app.models.user import User
from app.services.department_sync import ensure_department_path
from app.services.org_sync import _get_source_engine


def hr_dept_map() -> dict[str, str]:
    """招聘名册：工号 → 部门路径（'>' 分隔）。只读，失败直接抛错退出。"""
    engine = _get_source_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT emp_id, dept_path FROM org_members WHERE dept_path IS NOT NULL AND dept_path <> ''")
        ).all()
    return {r.emp_id.strip(): r.dept_path for r in rows if r.emp_id and r.emp_id.strip()}


def all_department_references(db) -> set[str]:
    """泛扫描本库所有名为 department_id 的列，收集被引用的部门 ID。"""
    refs: set[str] = set()
    cols = db.execute(
        text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = :db AND column_name = 'department_id'"
        ),
        {"db": settings.DB_NAME},
    ).all()
    for table, column in cols:
        vals = db.execute(
            text(f"SELECT DISTINCT `{column}` FROM `{table}` WHERE `{column}` IS NOT NULL")
        ).scalars().all()
        refs.update(vals)
    return refs


def prune_unreferenced(db, refs: set[str], apply: bool) -> int:
    """自底向上反复清理：无用户/课程等引用、且无子节点的部门碎片。"""
    removed = 0
    while True:
        depts = db.execute(select(Department)).scalars().all()
        ids = {d.id for d in depts}
        parents = {d.parent_id for d in depts if d.parent_id}
        doomed = [
            d for d in depts
            if d.id not in refs and d.id not in parents
        ]
        if not doomed:
            break
        for d in doomed:
            if apply:
                db.delete(d)
            removed += 1
        db.flush()
        # 防御：若一轮内 id 集合未缩小则停止（理论上不会发生）
        if {d.id for d in db.execute(select(Department)).scalars().all()} == ids:
            break
    return removed


def main() -> None:
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        hmap = hr_dept_map()
        print(f"HR 名册映射就绪：{len(hmap)} 个工号（只读，不落人员数据）")

        users = db.execute(select(User)).scalars().all()
        matched, unmatched = [], []
        changed_path = 0
        for u in users:
            emp = (u.employee_id or "").strip()
            dept_path = hmap.get(emp) if emp else None
            if not dept_path:
                unmatched.append(u)
                continue
            dashed = dept_path.replace(">", "-")
            if u.department == dashed and u.department_id:
                # 已挂标准链（幂等重跑时跳过链重建）
                dept = db.get(Department, u.department_id)
                if dept is not None:
                    continue
            leaf = ensure_department_path(db, dashed)
            if u.department != dashed or (leaf and u.department_id != leaf.id):
                changed_path += 1
            u.department = dashed
            if leaf:
                u.department_id = leaf.id
            matched.append(u)

        print(f"\n按工号命中 HR 名册：{len(matched)} 人（本次实际调整 {changed_path} 人）")
        if unmatched:
            print(f"\n未命中（保持原样，请在管理页面手动归位）：{len(unmatched)} 人")
            for u in unmatched:
                print(f"  - {u.name}（工号 {u.employee_id or '无'}，当前部门：{u.department or '未填'}）")

        refs = all_department_references(db)
        pruned = prune_unreferenced(db, refs, apply)
        print(f"\n可清理的碎片部门节点：{pruned} 个")

        if apply:
            db.commit()
            print("\n✅ 已落库（--apply）")
        else:
            db.rollback()
            print("\n（dry-run，未做任何修改；确认后加 --apply 执行）")
    finally:
        db.close()


if __name__ == "__main__":
    main()
