"""用户管理路由"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut, UserUpdateRole, UserCreate, UserUpdate, UserUpdateStatus
from app.routers.auth import get_current_user, require_admin, invalidate_user_cache
from app.services.auth_service import hash_password
import io
import openpyxl

router = APIRouter(prefix="/api/users", tags=["用户管理"])


@router.get("", response_model=list[UserOut])
def list_users(
    search: str | None = Query(None, description="搜索姓名/用户名/工号"),
    role: str | None = Query(None, description="筛选角色"),
    status: str | None = Query(None, description="筛选状态"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=200, description="每页数量"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取用户列表"""
    q = db.query(User)
    if search:
        q = q.filter(
            User.name.contains(search)
            | User.username.contains(search)
            | User.employee_id.contains(search)
        )
    if role:
        q = q.filter(User.role == role)
    if status:
        q = q.filter(User.status == status)
    return q.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """创建用户"""
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")
    if data.role not in ("student", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色无效")
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        name=data.name,
        employee_id=data.employee_id,
        department=data.department,
        role=data.role,
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    data: UserUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """编辑用户信息"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if data.name is not None:
        user.name = data.name
    if data.username is not None and data.username != user.username:
        existing = db.query(User).filter(User.username == data.username).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")
        user.username = data.username
    if data.employee_id is not None:
        user.employee_id = data.employee_id or None
    if data.department is not None:
        user.department = data.department or None
    if data.role is not None:
        if data.role not in ("student", "admin"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色无效")
        user.role = data.role
    if data.password is not None:
        user.password_hash = hash_password(data.password)
    db.commit()
    db.refresh(user)
    invalidate_user_cache(user_id)
    return user


@router.put("/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: str,
    data: UserUpdateRole,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """提升/撤销管理员角色"""
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改自己的角色")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if data.role not in ("student", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色无效")
    user.role = data.role
    db.commit()
    db.refresh(user)
    invalidate_user_cache(user_id)
    return user


@router.put("/{user_id}/status", response_model=UserOut)
def update_user_status(
    user_id: str,
    data: UserUpdateStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """启用/禁用用户"""
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改自己的状态")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if data.status not in ("active", "disabled"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="状态无效")
    user.status = data.status
    db.commit()
    db.refresh(user)
    invalidate_user_cache(user_id)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除用户"""
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    invalidate_user_cache(user_id)
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/batch-import")
async def batch_import_users(
    file: UploadFile = File(...),
    department_id: str | None = Query(None, description="导入到的部门 ID"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """批量导入用户（Excel 文件）"""
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 .xlsx / .xls 文件")

    # 读取 Excel
    contents = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(contents))
    ws = wb.active

    # 解析表头
    headers = [cell.value for cell in ws[1]]
    col_map = {h: i for i, h in enumerate(headers) if h}

    required = ["姓名", "用户名", "密码"]
    for r in required:
        if r not in col_map:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"缺少必填列: {r}")

    # 如果指定了部门，获取部门名称
    dept_name = None
    if department_id:
        from app.models.department import Department
        dept = db.query(Department).filter(Department.id == department_id).first()
        if dept:
            dept_name = dept.name

    success_count = 0
    skip_count = 0
    errors: list[str] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        name = row[col_map["姓名"]] if row[col_map["姓名"]] else None
        username = row[col_map["用户名"]] if row[col_map["用户名"]] else None
        password = row[col_map["密码"]] if row[col_map["密码"]] else None

        if not name or not username or not password:
            errors.append(f"第 {row_idx} 行：缺少必填字段")
            skip_count += 1
            continue

        # 工号
        employee_id = None
        if "工号" in col_map and row[col_map["工号"]]:
            employee_id = str(row[col_map["工号"]]).strip()

        # 部门（优先用 Excel 中的，否则用参数指定的）
        department = dept_name
        if "部门" in col_map and row[col_map["部门"]]:
            department = str(row[col_map["部门"]]).strip()

        # 校验部门名称是否存在
        if department:
            from app.models.department import Department as DeptModel
            dept_exists = db.query(DeptModel).filter(DeptModel.name == department).first()
            if not dept_exists:
                errors.append(f"第 {row_idx} 行：部门「{department}」不存在")
                skip_count += 1
                continue

        # 角色
        role = "student"
        if "角色" in col_map and row[col_map["角色"]]:
            role_val = str(row[col_map["角色"]]).strip()
            if role_val in ("管理员", "admin"):
                role = "admin"

        # 检查用户名重复
        existing = db.query(User).filter(User.username == str(username).strip()).first()
        if existing:
            errors.append(f"第 {row_idx} 行：用户名 {username} 已存在")
            skip_count += 1
            continue

        try:
            user = User(
                name=str(name).strip(),
                username=str(username).strip(),
                password_hash=hash_password(str(password).strip()),
                employee_id=employee_id,
                department=department,
                role=role,
                status="active",
            )
            db.add(user)
            db.flush()  # 逐行 flush，单行失败不影响其他行
            success_count += 1
        except Exception as e:
            db.rollback()
            errors.append(f"第 {row_idx} 行：写入失败 - {e}")
            skip_count += 1

    db.commit()

    return {
        "success_count": success_count,
        "skip_count": skip_count,
        "total": success_count + skip_count,
        "errors": errors[:20],  # 最多返回 20 条错误
    }


@router.get("/batch-import/template")
def download_template(
    _: User = Depends(require_admin),
):
    """下载批量导入模板"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "用户导入模板"
    ws.append(["姓名", "用户名", "密码", "工号", "部门", "角色"])
    # 示例行
    ws.append(["张三", "zhangsan", "Abc12345", "E001", "研发部", "学员"])
    ws.append(["李四", "lisi", "Abc12345", "E002", "研发部", "管理员"])

    # 设置列宽
    for col, width in zip(["A", "B", "C", "D", "E", "F"], [10, 15, 12, 10, 12, 10]):
        ws.column_dimensions[col].width = width

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=user_import_template.xlsx"},
    )