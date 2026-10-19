"""课程课件路由：PDF / PPT(PPTX) / HTML / 图片 学习文件的上传、预览、下载、删除。

文件存服务器本地 uploads/courses/（services/course_files.py 收敛路径与清理），
预览/下载鉴权与 get_course 同口径：get_current_user + check_course_assignment
（admin 恒通过；学员必须被分配该课程，防止凭 material_id 越权读未分配课件）。
"""

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.logger import get_logger
from app.models.course import Course, CourseMaterial
from app.models.user import User
from app.routers.auth import get_current_user, require_admin
from app.schemas.course import CourseMaterialOut
from app.services import course_files
from app.services.department_scope import check_course_assignment
from app.services.log_service import write_log
from app.services.office_convert import convert_office_to_pdf

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["课程课件"])


def _get_material_or_404(db: Session, material_id: str) -> CourseMaterial:
    material = db.query(CourseMaterial).filter(CourseMaterial.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="课件不存在")
    return material


def _check_student_access(db: Session, user: User, course_id: str) -> None:
    if not check_course_assignment(db, user, course_id):
        raise HTTPException(status_code=403, detail="未分配该课程")


# ── 管理端：上传 / 删除 ──

@router.post("/courses/{course_id}/materials", response_model=CourseMaterialOut)
async def upload_course_material(
    course_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """上传课程课件（PDF/PPT/PPTX/HTML/图片 PNG·JPG 等，≤50MB；PPT 自动尝试转 PDF 作预览产物）"""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    ext = course_files.ext_of(file.filename)
    if ext not in course_files.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: .{ext}，支持: {', '.join(sorted(course_files.ALLOWED_EXTENSIONS))}",
        )

    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(course_files.UPLOAD_DIR, filename)

    # 流式写盘 + 边写边限流，超限删除半成品（与知识库课件同套路）
    file_size = 0
    try:
        with open(filepath, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
                file_size += len(chunk)
                if file_size > course_files.MAX_FILE_SIZE:
                    f.close()
                    os.remove(filepath)
                    raise HTTPException(
                        status_code=400,
                        detail=f"文件过大，最大支持 {course_files.MAX_FILE_SIZE // 1024 // 1024}MB",
                    )
    except HTTPException:
        raise
    except OSError as exc:
        logger.error("课件写盘失败: %s, error=%s", filepath, exc)
        if os.path.exists(filepath):
            os.remove(filepath)
        raise HTTPException(status_code=500, detail="文件保存失败")

    max_order = db.query(CourseMaterial).filter(CourseMaterial.course_id == course_id).count()
    material = CourseMaterial(
        id=str(uuid.uuid4()),
        course_id=course_id,
        original_name=file.filename,
        obs_key=filename,
        file_size=file_size,
        file_type=ext,
        sort_order=max_order,
    )
    db.add(material)
    db.commit()
    db.refresh(material)

    # PPT/PPTX 自动转 PDF（转换失败内部记日志，不阻断上传）
    if ext in ("ppt", "pptx"):
        convert_office_to_pdf(filepath, ext)

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="course", action="upload", resource_type="课程课件",
        resource_name=file.filename,
        description=f"{current_user.name} 为课程「{course.title}」上传了课件「{file.filename}」",
        level="info",
    )
    return CourseMaterialOut.model_validate(material)


@router.delete("/course-materials/{material_id}")
def delete_course_material(
    material_id: str,
    confirm: bool = Query(False, description="必须显式传 true 才执行删除"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除课件（含磁盘文件与 PPT 转换出的 PDF 副本）"""
    if not confirm:
        raise HTTPException(status_code=400, detail="删除课件需要显式确认（confirm=true）")

    material = _get_material_or_404(db, material_id)
    # commit 后实例属性过期，先取字符串快照
    obs_key, file_type, original_name = material.obs_key, material.file_type, material.original_name
    db.delete(material)
    db.commit()

    # 事务成功后再清理磁盘，避免回滚后文件已丢失
    course_files.remove_from_disk(obs_key, file_type)

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="course", action="delete", resource_type="课程课件",
        resource_name=original_name,
        description=f"{current_user.name} 删除了课件「{original_name}」",
        level="warning",
    )
    return {"ok": True}


# ── 预览 / 下载（管理端与学员端共用一套端点） ──
# 鉴权走 check_course_assignment：admin 恒通过，学员需被分配该课程。

@router.get("/course-materials/{material_id}/preview")
def preview_course_material(
    material_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """预览课件（PPT/PPTX 自动返回转换后的 PDF）"""
    material = _get_material_or_404(db, material_id)
    _check_student_access(db, current_user, material.course_id)

    # 懒转换兜底：上传时转换失败（或当时服务端无 LibreOffice）的存量 PPT，
    # 在预览请求到达时补转一次；仍失败则落回原文件，由前端降级为下载引导
    if material.file_type in ("ppt", "pptx"):
        origin = course_files.resolve_path(material.obs_key)
        if not os.path.exists(os.path.splitext(origin)[0] + ".pdf"):
            convert_office_to_pdf(origin, material.file_type)

    filepath = course_files.resolve_preview_path(material)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = course_files.ext_of(os.path.basename(filepath))
    media_type = course_files.MIME_MAP.get(ext, "application/octet-stream")
    return FileResponse(filepath, media_type=media_type)


@router.get("/course-materials/{material_id}/download")
def download_course_material(
    material_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """下载课件原文件"""
    material = _get_material_or_404(db, material_id)
    _check_student_access(db, current_user, material.course_id)

    filepath = course_files.resolve_path(material.obs_key)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    media_type = course_files.MIME_MAP.get(material.file_type, "application/octet-stream")
    return FileResponse(filepath, media_type=media_type, filename=material.original_name)
