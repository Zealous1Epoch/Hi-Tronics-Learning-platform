"""部门归属与课程分配的统一判定服务。

修复要点（原实现散落在 courses.py / learning_progress.py / tasks.py，各写一份且都有缺陷）：

1. 原实现一律用 `user.department.split("-")[-1]` 取叶子名，再
   `Department.name == 叶子名` + `.first()` 反查 ID。组织内只要出现两个同名叶子部门
   （如两条业务线下都有「综合部」），就会取到任意一个，导致课程分配与进度统计算错人。
   现改为：**优先使用 `user.department_id` 外键**；仅在历史数据缺 `department_id` 时，
   才按完整路径消歧回退。

2. 原实现只匹配用户「自身」所在部门，把课程分配给父部门（如「IT部」）时，
   子部门（「IT部-开发组」）的成员看不到课程。现统一包含所有后代部门。

3. 原实现 N+1 查库。现一次性加载部门表在内存中构树。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.course import Course, CourseAssignment
from app.models.department import Department
from app.models.user import User


@dataclass(frozen=True)
class _DeptIndex:
    """一次性的部门索引，避免逐次查库（原实现每处都做 N+1 查询）。"""

    by_id: dict[str, Department]
    by_parent: dict[str | None, list[Department]]
    full_path: dict[str, str]          # dept_id -> "IT部-开发组"
    path_to_id: dict[str, str]         # "IT部-开发组" -> dept_id（唯一路径才收录）


def _build_index(db: Session) -> _DeptIndex:
    depts = db.query(Department).all()
    by_id = {d.id: d for d in depts}
    by_parent: dict[str | None, list[Department]] = {}
    for d in depts:
        by_parent.setdefault(d.parent_id, []).append(d)

    full_path: dict[str, str] = {}

    def resolve(dept: Department, guard: set[str]) -> str:
        """自底向上拼路径，带环保护。"""
        if dept.id in full_path:
            return full_path[dept.id]
        if dept.id in guard:  # 数据异常出现环，截断避免死循环
            return dept.name
        guard.add(dept.id)
        parent = by_id.get(dept.parent_id) if dept.parent_id else None
        path = f"{resolve(parent, guard)}-{dept.name}" if parent else dept.name
        full_path[dept.id] = path
        return path

    for d in depts:
        resolve(d, set())

    # 只有路径唯一的部门才用于回退匹配，避免歧义
    counts: dict[str, int] = {}
    for p in full_path.values():
        counts[p] = counts.get(p, 0) + 1
    path_to_id = {
        p: did for did, p in full_path.items() if counts.get(p, 0) == 1
    }
    return _DeptIndex(by_id=by_id, by_parent=by_parent, full_path=full_path, path_to_id=path_to_id)


def get_user_department_id(db: Session, user: User) -> str | None:
    """解析用户所属部门 ID。

    优先 `user.department_id`（外键，权威）；缺失时按 `user.department` 完整路径消歧回退。
    """
    if getattr(user, "department_id", None):
        return user.department_id
    if not user.department:
        return None

    idx = _build_index(db)
    raw = user.department.strip()
    # 完整路径精确匹配（唯一）
    if raw in idx.path_to_id:
        return idx.path_to_id[raw]

    # 退化：只有叶子名（无 "-"），且全局唯一才接受
    leaf = raw.split("-")[-1].strip()
    if not leaf:
        return None
    candidates = [did for did, p in idx.full_path.items() if p.split("-")[-1] == leaf]
    if len(candidates) == 1:
        return candidates[0]
    return None  # 有歧义则宁可不匹配，也不猜错人


def get_department_scope_ids(db: Session, dept_id: str) -> list[str]:
    """返回部门及其全部后代部门的 ID。"""
    idx = _build_index(db)
    out: list[str] = []
    stack = [dept_id]
    seen: set[str] = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        out.append(cur)
        for child in idx.by_parent.get(cur, []):
            stack.append(child.id)
    return out


def get_department_chain_ids(db: Session, dept_id: str, idx: _DeptIndex | None = None) -> set[str]:
    """返回部门自身 + 全部祖先 + 全部后代的 ID 集合。

    课程可以分配给「IT部」而成员挂在「IT部-开发组」（后代），也可能反向；
    判定时把整条链纳入，避免因挂载层级不一致而漏人。
    """
    idx = idx or _build_index(db)
    chain: set[str] = set()

    # 自身 + 全部后代
    stack = [dept_id]
    while stack:
        cur = stack.pop()
        if cur in chain:
            continue
        chain.add(cur)
        for child in idx.by_parent.get(cur, []):
            stack.append(child.id)

    # 祖先链
    cur = idx.by_id.get(dept_id)
    guard: set[str] = set()
    while cur and cur.parent_id and cur.id not in guard:
        guard.add(cur.id)
        parent = idx.by_id.get(cur.parent_id)
        if not parent:
            break
        chain.add(parent.id)
        cur = parent

    return chain


def is_admin(user: User) -> bool:
    return getattr(user, "role", None) == "admin"


def check_course_assignment(db: Session, user: User, course_id: str) -> bool:
    """判断用户是否被分配了指定课程（管理员始终为真）。

    匹配规则：分配给本人，或分配给「本人所在部门链上的任一部门」（自身/祖先/后代）。
    """
    if is_admin(user):
        return True

    dept_ids: set[str] = set()
    own = get_user_department_id(db, user)
    if own:
        dept_ids = get_department_chain_ids(db, own)

    conditions = [CourseAssignment.user_id == user.id]
    if dept_ids:
        conditions.append(CourseAssignment.department_id.in_(dept_ids))

    from sqlalchemy import or_

    return (
        db.query(CourseAssignment.id)
        .filter(CourseAssignment.course_id == course_id, or_(*conditions))
        .first()
        is not None
    )


def get_assigned_course_ids(db: Session, user: User) -> list[str]:
    """返回用户可见（已分配）的课程 ID 列表；管理员返回全部已发布课程。"""
    if is_admin(user):
        return [row[0] for row in db.query(Course.id).filter(Course.status == "published").all()]

    dept_ids: set[str] = set()
    own = get_user_department_id(db, user)
    if own:
        dept_ids = get_department_chain_ids(db, own)

    from sqlalchemy import or_

    conditions = [CourseAssignment.user_id == user.id]
    if dept_ids:
        conditions.append(CourseAssignment.department_id.in_(dept_ids))

    rows = db.query(CourseAssignment.course_id).filter(or_(*conditions)).all()
    return list({r[0] for r in rows})


def get_course_students(db: Session, course_id: str) -> list[User]:
    """返回某课程的「应到学员」名单（直接分配 + 部门分配命中的在册学员）。

    用于签到场次的应到名单、未签到统计与课程完成度分母。
    一次性加载部门索引并缓存每个部门的链集合，避免逐个学员查库。
    """
    assignments = (
        db.query(CourseAssignment).filter(CourseAssignment.course_id == course_id).all()
    )
    direct_user_ids = {a.user_id for a in assignments if a.user_id}
    assigned_dept_ids = {a.department_id for a in assignments if a.department_id}

    if not direct_user_ids and not assigned_dept_ids:
        return []

    students = db.query(User).filter(User.role == "student", User.status == "active").all()
    if not assigned_dept_ids:
        return [s for s in students if s.id in direct_user_ids]

    idx = _build_index(db)
    chain_cache: dict[str, set[str]] = {}
    result: list[User] = []
    for s in students:
        if s.id in direct_user_ids:
            result.append(s)
            continue
        if not s.department_id:
            continue
        chain = chain_cache.get(s.department_id)
        if chain is None:
            chain = get_department_chain_ids(db, s.department_id, idx)
            chain_cache[s.department_id] = chain
        if chain & assigned_dept_ids:
            result.append(s)
    return result
