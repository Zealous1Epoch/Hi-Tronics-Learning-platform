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
    """递归构建部门树"""
    children = [d for d in departments if d.parent_id == parent_id]
    return [
        DepartmentOut(
            id=d.id,
            name=d.name,
            parent_id=d.parent_id,
            children=build_tree(departments, d.id),
        )
        for d in children
    ]


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

    # 一次性加载所有部门，在内存中收集子部门名称
    all_depts = db.query(Department).all()
    dept_map: dict[str, list[Department]] = {}
    for d in all_depts:
        parent_key = d.parent_id or ""
        dept_map.setdefault(parent_key, []).append(d)

    def collect_names_in_memory(parent_id: str) -> list[str]:
        names: list[str] = []
        children = dept_map.get(parent_id, [])
        for child in children:
            names.append(child.name)
            names.extend(collect_names_in_memory(child.id))
        return names

    dept_names = [dept.name] + collect_names_in_memory(dept_id)

    # 兼容：精确匹配叶子名 / 后缀匹配完整路径（父-子）
    dept_conditions = [User.department.in_(dept_names)]
    for name in dept_names:
        dept_conditions.append(User.department.like(f"%-{name}"))
    q = db.query(User).filter(or_(*dept_conditions))
    if search:
        q = q.filter(
            User.name.contains(search)
            | User.username.contains(search)
            | User.employee_id.contains(search)
        )
    return q.order_by(User.created_at.desc()).all()