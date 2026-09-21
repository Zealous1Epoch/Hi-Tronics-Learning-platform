"""部门管理路由"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models.department import Department
from app.models.user import User
from app.schemas.department import DepartmentCreate, DepartmentUpdate, DepartmentOut, FlatDepartmentOut
from app.schemas.user import UserOut
from app.routers.auth import get_current_user, require_admin
from app.services.log_service import write_log

router = APIRouter(prefix="/api/departments", tags=["部门管理"])


def build_tree(departments: list[Department], parent_id: str | None = None) -> list[DepartmentOut]:
    """递归构建部门树。

    性能修复：原实现每层都 `[d for d in departments if d.parent_id == pid]` 全量扫描，
    整体复杂度 O(n²)；部门数量多时明显变慢。现先建一次 parent_id → children 索引，
    再递归，降为 O(n)。
    """
    children_map: dict[str | None, list[Department]] = {}
    for d in departments:
        children_map.setdefault(d.parent_id, []).append(d)

    def build(pid: str | None, visited: set[str | None]) -> list[DepartmentOut]:
        if pid in visited:      # 数据异常出现环时截断，避免无限递归
            return []
        visited.add(pid)
        return [
            DepartmentOut(
                id=d.id,
                name=d.name,
                parent_id=d.parent_id,
                children=build(d.id, visited),
            )
            for d in children_map.get(pid, [])
        ]

    return build(parent_id, set())


@router.get("", response_model=list[DepartmentOut])
def list_departments(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取部门树"""
    all_deps = db.query(Department).all()
    return build_tree(all_deps)


@router.post("", response_model=DepartmentOut)
def create_department(
    data: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """创建部门"""
    dept = Department(name=data.name, parent_id=data.parent_id)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="user", action="create", resource_type="部门", resource_name=dept.name if hasattr(dept, 'name') else "", description=f"{current_user.name} 创建了部门「{dept.name}」", level="info")
    return DepartmentOut(id=dept.id, name=dept.name, parent_id=dept.parent_id, children=[])


@router.put("/{dept_id}", response_model=DepartmentOut)
def update_department(
    dept_id: str,
    data: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """更新部门"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")
    if data.name is not None and data.name != dept.name:
        old_name = dept.name
        dept.name = data.name
        # 同步更新关联用户的 department 字段
        db.query(User).filter(User.department == old_name).update(
            {User.department: data.name}, synchronize_session=False
        )
    elif data.name is not None:
        dept.name = data.name
    if data.parent_id is not None:
        dept.parent_id = data.parent_id
    db.commit()
    db.refresh(dept)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="user", action="update", resource_type="部门", resource_name=dept.name if hasattr(dept, 'name') else "", description=f"{current_user.name} 编辑了部门「{dept.name}」", level="info")
    return DepartmentOut(id=dept.id, name=dept.name, parent_id=dept.parent_id, children=[])


@router.delete("/{dept_id}")
def delete_department(
    dept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除部门（含所有后代子部门）"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

    # 深度优先收集所有后代节点 ID（含自身），叶子在前
    def collect_descendant_ids(parent_id: str) -> list[str]:
        ids: list[str] = []
        children = db.query(Department).filter(Department.parent_id == parent_id).all()
        for child in children:
            ids.extend(collect_descendant_ids(child.id))
        ids.append(parent_id)
        return ids

    all_ids = collect_descendant_ids(dept_id)

    # 收集被删除部门的所有名称，清理关联用户的 department 字段
    dept_names = (
        db.query(Department.name)
        .filter(Department.id.in_(all_ids))
        .all()
    )
    names_to_clear = [name for (name,) in dept_names]
    if names_to_clear:
        db.query(User).filter(User.department.in_(names_to_clear)).update(
            {User.department: None}, synchronize_session=False
        )

    # 从深到浅删除，避免外键约束问题
    for did in all_ids:
        db.query(Department).filter(Department.id == did).delete()
    db.commit()
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="user", action="delete", resource_type="部门", resource_name=dept.name, description=f"{current_user.name} 删除了部门「{dept.name}」", level="warning")
    return {"ok": True}


@router.get("/flat", response_model=list[FlatDepartmentOut])
def list_departments_flat(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取部门扁平列表"""
    return db.query(Department).order_by(Department.name).all()


@router.get("/{dept_id}/users", response_model=list[UserOut])
def get_department_users(
    dept_id: str,
    search: str | None = Query(None, description="搜索姓名/用户名/工号"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取部门及其所有子部门的用户"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")

    # 一次性加载所有部门，在内存中收集后代部门 ID 和名称
    all_depts = db.query(Department).all()
    dept_map: dict[str, list[Department]] = {}
    for d in all_depts:
        parent_key = d.parent_id or ""
        dept_map.setdefault(parent_key, []).append(d)

    def collect_descendants(parent_id: str) -> tuple[list[str], list[str]]:
        ids: list[str] = []
        names: list[str] = []
        children = dept_map.get(parent_id, [])
        for child in children:
            ids.append(child.id)
            names.append(child.name)
            child_ids, child_names = collect_descendants(child.id)
            ids.extend(child_ids)
            names.extend(child_names)
        return ids, names

    descendant_ids, descendant_names = collect_descendants(dept_id)

    # department_id 精确匹配（优先） + 文本路径兼容匹配
    dept_ids = [dept_id] + descendant_ids
    dept_text_names = [dept.name] + descendant_names

    conditions = [User.department_id.in_(dept_ids)]
    conditions.append(User.department.in_(dept_text_names))
    for name in dept_text_names:
        conditions.append(User.department.like(f"%-{name}"))

    q = db.query(User).filter(or_(*conditions))
    if search:
        q = q.filter(
            User.name.contains(search)
            | User.username.contains(search)
            | User.employee_id.contains(search)
        )
    return q.order_by(User.created_at.desc()).all()