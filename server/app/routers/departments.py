"""部门管理路由"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.department import Department
from app.models.user import User
from app.schemas.department import DepartmentCreate, DepartmentUpdate, DepartmentOut
from app.routers.auth import get_current_user, require_admin

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
    _: User = Depends(require_admin),
):
    """创建部门"""
    dept = Department(name=data.name, parent_id=data.parent_id)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return DepartmentOut(id=dept.id, name=dept.name, parent_id=dept.parent_id, children=[])


@router.put("/{dept_id}", response_model=DepartmentOut)
def update_department(
    dept_id: str,
    data: DepartmentUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """更新部门"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")
    if data.name is not None:
        dept.name = data.name
    if data.parent_id is not None:
        dept.parent_id = data.parent_id
    db.commit()
    db.refresh(dept)
    return DepartmentOut(id=dept.id, name=dept.name, parent_id=dept.parent_id, children=[])


@router.delete("/{dept_id}")
def delete_department(
    dept_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """删除部门（如有子部门一并删除）"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")
    # 递归删除子部门
    children = db.query(Department).filter(Department.parent_id == dept_id).all()
    for child in children:
        db.delete(child)
    db.delete(dept)
    db.commit()
    return {"ok": True}