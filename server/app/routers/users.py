"""用户管理路由"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut, UserUpdateRole, UserCreate, UserUpdate, UserUpdateStatus
from app.routers.auth import get_current_user, require_admin, invalidate_user_cache
from app.services.auth_service import hash_password
from app.services.log_service import write_log
from app.services.department_sync import ensure_department_path
from app.models.department import Department
import io
import openpyxl

router = APIRouter(prefix="/api/users", tags=["用户管理"])


@router.get("", response_model=list[UserOut])
def list_users(
    search: str | None = Query(None, description="搜索姓名/用户名/工号"),
    role: str | None = Query(None, description="筛选角色"),
    status: str | None = Query(None, description="筛选状态"),
    department_id: str | None = Query(None, description="筛选部门 ID"),
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
    if department_id:
        q = q.filter(User.department_id == department_id)
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

    # 处理部门关联
    department_text = data.department
    department_id = data.department_id

    if department_id:
        # department_id 优先：查找部门并计算完整路径
        dept = db.query(Department).filter(Department.id == department_id).first()
        if not dept:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")
        # 从叶子节点向上构建完整路径
        parts = []
        cur = dept
        while cur:
            parts.insert(0, cur.name)
            cur = db.query(Department).filter(Department.id == cur.parent_id).first() if cur.parent_id else None
        department_text = "-".join(parts)
    elif department_text and not department_id:
        # 只有文本路径：自动同步到 Department 树
        leaf = ensure_department_path(db, department_text)
        if leaf:
            department_id = leaf.id

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        name=data.name,
        employee_id=data.employee_id,
        department=department_text,
        department_id=department_id,
        role=data.role,
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    write_log(db=db, operator=_.name, operator_id=_.id, category="user", action="create", resource_type="用户", resource_name=data.name, description=f"{_.name} 创建了用户「{data.name}」", level="info")
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

    # 处理部门关联
    if data.department_id is not None:
        # department_id 更新：查找部门并计算路径
        if data.department_id:
            dept = db.query(Department).filter(Department.id == data.department_id).first()
            if not dept:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="部门不存在")
            # 从叶子节点向上构建完整路径
            parts = []
            cur = dept
            while cur:
                parts.insert(0, cur.name)
                cur = db.query(Department).filter(Department.id == cur.parent_id).first() if cur.parent_id else None
            user.department = "-".join(parts)
            user.department_id = data.department_id
        else:
            # department_id 设为空 → 清除部门
            user.department = None
            user.department_id = None
    elif data.department is not None:
        # 只有文本路径更新：自动同步 Department 树
        if data.department:
            user.department = data.department
            leaf = ensure_department_path(db, data.department)
            user.department_id = leaf.id if leaf else None
        else:
            user.department = None
            user.department_id = None
    if data.role is not None:
        if data.role not in ("student", "admin"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色无效")
        user.role = data.role
    if data.password is not None:
        user.password_hash = hash_password(data.password)
    db.commit()
    db.refresh(user)
    invalidate_user_cache(user_id)
    write_log(db=db, operator=_.name, operator_id=_.id, category="user", action="update", resource_type="用户", resource_name=user.name, description=f"{_.name} 编辑了用户「{user.name}」", level="info")
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="user", action="update", resource_type="用户", resource_name=user.name, description=f"{current_user.name} 将用户「{user.name}」角色改为 {data.role}", level="info")
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="user", action="update", resource_type="用户", resource_name=user.name, description=f"{current_user.name} 将用户「{user.name}」状态改为 {data.status}", level="info")
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="user", action="delete", resource_type="用户", resource_name=user.name, description=f"{current_user.name} 删除了用户「{user.name}」", level="warning")
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

    write_log(db=db, operator=_.name, operator_id=_.id, category="user", action="import", resource_type="用户", resource_name="", description=f"{_.name} 批量导入了 {success_count} 个用户", level="info")
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

    # 样式定义
    header_font = openpyxl.styles.Font(name="微软雅黑", bold=True, size=11, color="FFFFFF")
    header_fill = openpyxl.styles.PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
    header_alignment = openpyxl.styles.Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = openpyxl.styles.Border(
        left=openpyxl.styles.Side(style="thin", color="C0C0C0"),
        right=openpyxl.styles.Side(style="thin", color="C0C0C0"),
        top=openpyxl.styles.Side(style="thin", color="C0C0C0"),
        bottom=openpyxl.styles.Side(style="thin", color="C0C0C0"),
    )
    sample_font = openpyxl.styles.Font(name="微软雅黑", size=10)
    tip_font = openpyxl.styles.Font(name="微软雅黑", size=9, color="888888", italic=True)

    # 表头
    headers = ["姓名", "用户名", "密码", "工号", "部门", "角色"]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    # 示例行
    samples = [
        ["张三", "zhangsan", "Abc12345", "E001", "研发部", "学员"],
        ["李四", "lisi", "Abc12345", "E002", "研发部", "管理员"],
    ]
    for row_idx, sample in enumerate(samples, start=2):
        for col_idx, val in enumerate(sample, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.font = sample_font
            cell.alignment = openpyxl.styles.Alignment(vertical="center", wrap_text=True)
            cell.border = thin_border

    # 列宽
    col_widths = [10, 15, 14, 10, 12, 10]
    for i, width in enumerate(col_widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = width

    # 冻结首行
    ws.freeze_panes = "A2"

    # 数据验证：角色下拉
    role_dv = openpyxl.worksheet.datavalidation.DataValidation(
        type="list",
        formula1='"学员,管理员"',
        allow_blank=True,
    )
    role_dv.error = "请从下拉列表中选择角色"
    role_dv.errorTitle = "输入错误"
    role_dv.prompt = "请选择角色"
    role_dv.promptTitle = "角色"
    ws.add_data_validation(role_dv)
    role_dv.add(f"F2:F1000")

    # 添加说明 sheet
    ws2 = wb.create_sheet(title="填写说明")
    notes = [
        ["字段", "说明", "备注"],
        ["姓名", "必填。用户真实姓名", ""],
        ["用户名", "必填。登录用的用户名", "不能与已有用户重复"],
        ["密码", "必填。登录密码", ""],
        ["工号", "选填。员工编号", ""],
        ["部门", "选填。如已在系统界面选择部门，可不填", "部门名称必须已存在系统中"],
        ["角色", "必填。学员 / 管理员", "请从下拉列表中选择"],
    ]
    for row_idx, row in enumerate(notes, start=1):
        for col_idx, val in enumerate(row, start=1):
            cell = ws2.cell(row=row_idx, column=col_idx, value=val)
            if row_idx == 1:
                cell.font = openpyxl.styles.Font(name="微软雅黑", bold=True, size=11, color="1B365D")
            else:
                cell.font = openpyxl.styles.Font(name="微软雅黑", size=10)
            cell.alignment = openpyxl.styles.Alignment(vertical="center", wrap_text=True)
            cell.border = thin_border

    ws2.column_dimensions["A"].width = 10
    ws2.column_dimensions["B"].width = 50
    ws2.column_dimensions["C"].width = 30

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=user_import_template.xlsx"},
    )