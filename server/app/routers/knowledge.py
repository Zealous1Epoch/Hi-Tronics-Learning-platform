"""知识节点管理路由"""

import uuid
import os
import subprocess
from shutil import which as shutil_which
from app.services.log_service import write_log
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.knowledge_node import KnowledgeNode, KnowledgeFile
from app.schemas.knowledge_node import (
    KnowledgeNodeCreate, KnowledgeNodeUpdate, KnowledgeNodeOut,
    PositionUpdate, KnowledgeFileOut,
)
from app.routers.auth import get_current_user, require_admin
from app.logger import get_logger

logger = get_logger(__name__)

# PPTX 文字提取（可选依赖，缺失时降级为不支持）
try:
    from pptx import Presentation as PptxPresentation  # noqa: F811
    HAS_PPTX_LIB = True
except Exception:
    HAS_PPTX_LIB = False

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "knowledge")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# LibreOffice 路径（macOS App / Linux 命令行）
_SOFFICE_CANDIDATES = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
    "libreoffice",
]
SOFFICE = next((p for p in _SOFFICE_CANDIDATES if os.path.exists(p) or shutil_which(p)), None)

def _soffice_available() -> bool:
    """检测 LibreOffice 是否可用"""
    if not SOFFICE:
        return False
    try:
        subprocess.run([SOFFICE, "--version"], capture_output=True, timeout=10)
        return True
    except Exception:
        return False


def _convert_to_pdf(filepath: str, ext: str) -> str | None:
    """将 PPT/PPTX 转换为 PDF，返回 PDF 路径。失败返回 None。

    修复：原先失败时 `except Exception: pass` 静默吞掉，运维无法发现
    LibreOffice 缺失或转换失败（表现为学员端 PPT 预览一直空白）。现记录日志。
    """
    if ext not in ("ppt", "pptx"):
        return None
    if not _soffice_available():
        logger.warning("LibreOffice 不可用，跳过 PPT→PDF 转换: %s", os.path.basename(filepath))
        return None
    try:
        outdir = os.path.dirname(filepath)
        subprocess.run(
            [SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", outdir, filepath],
            capture_output=True, text=True, timeout=60,
            check=True,
        )
        # LibreOffice 输出为同名 .pdf
        pdf_path = os.path.splitext(filepath)[0] + ".pdf"
        if os.path.exists(pdf_path):
            return pdf_path
        logger.warning("PPT→PDF 转换未生成输出文件: %s", os.path.basename(filepath))
    except Exception as exc:  # noqa: BLE001 — 转换失败不应阻断上传
        logger.error("PPT→PDF 转换失败: %s, error=%s", os.path.basename(filepath), exc)
    return None

ALLOWED_EXTENSIONS = {
    "pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx",
    "html", "htm", "png", "jpg", "jpeg", "gif", "svg", "webp",
    "txt", "md", "csv",
}

router = APIRouter(prefix="/api", tags=["知识节点"])


# ── 辅助函数 ──

def _get_files_by_node(db: Session, node_ids: list[str]) -> dict[str, list[KnowledgeFile]]:
    """批量查询文件，按 node_id 分组"""
    if not node_ids:
        return {}
    all_files = (
        db.query(KnowledgeFile)
        .filter(KnowledgeFile.node_id.in_(node_ids))
        .order_by(KnowledgeFile.sort_order)
        .all()
    )
    result: dict[str, list[KnowledgeFile]] = {}
    for f in all_files:
        result.setdefault(f.node_id, []).append(f)
    return result


def build_node_tree(
    nodes: list[KnowledgeNode],
    files_map: dict[str, list[KnowledgeFile]],
    parent_id: str | None = None,
) -> list[KnowledgeNodeOut]:
    """构建知识节点树。

    性能修复：原实现每层都全量过滤 nodes（`[n for n in nodes if n.parent_id == pid]`），
    整体 O(n²)，知识节点多时明显变慢。现先建立 parent_id → children 索引，降为 O(n)。
    """
    children_map: dict[str | None, list[KnowledgeNode]] = {}
    for n in nodes:
        children_map.setdefault(n.parent_id, []).append(n)
    for items in children_map.values():
        items.sort(key=lambda x: x.sort_order)

    def build(pid: str | None, visited: set[str | None]) -> list[KnowledgeNodeOut]:
        if pid in visited:      # 数据异常出现环时截断，避免无限递归
            return []
        visited.add(pid)
        return [
            KnowledgeNodeOut(
                id=n.id, title=n.title, description=n.description,
                content=n.content, parent_id=n.parent_id,
                position_x=n.position_x, position_y=n.position_y,
                sort_order=n.sort_order, status=n.status,
                created_at=n.created_at, updated_at=n.updated_at,
                children=build(n.id, visited),
                files=[KnowledgeFileOut.model_validate(f) for f in files_map.get(n.id, [])],
            )
            for n in children_map.get(pid, [])
        ]

    return build(parent_id, set())


def _remove_knowledge_file_from_disk(knowledge_file: KnowledgeFile) -> None:
    """删除课件磁盘文件，同时清理 PPT/PPTX 自动转换产生的 PDF 副本。

    修复：原先只在「删除文件」接口里清理转换产物，「删除知识节点」时不会清理，
    导致 PPT 转换出的 PDF 永久残留在 uploads/knowledge 下。
    """
    filepath = os.path.join(UPLOAD_DIR, knowledge_file.obs_key)
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except OSError as exc:
            logger.error("删除课件文件失败: %s, error=%s", filepath, exc)
    if _get_ext(knowledge_file.original_name) in ("ppt", "pptx"):
        pdf_path = os.path.splitext(filepath)[0] + ".pdf"
        if os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except OSError as exc:
                logger.error("删除课件转换 PDF 失败: %s, error=%s", pdf_path, exc)


# ── 管理端 API ──

@router.get("/knowledge-nodes", response_model=list[KnowledgeNodeOut])
def list_knowledge_nodes(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取知识节点树（管理端，含草稿）"""
    all_nodes = db.query(KnowledgeNode).order_by(KnowledgeNode.sort_order).all()
    node_ids = [n.id for n in all_nodes]
    files_map = _get_files_by_node(db, node_ids)
    return build_node_tree(all_nodes, files_map)


@router.get("/knowledge-nodes/{node_id}", response_model=KnowledgeNodeOut)
def get_knowledge_node(
    node_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取单个节点详情（管理端）"""
    node = db.query(KnowledgeNode).filter(KnowledgeNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="知识节点不存在")
    files = (
        db.query(KnowledgeFile)
        .filter(KnowledgeFile.node_id == node_id)
        .order_by(KnowledgeFile.sort_order)
        .all()
    )
    return KnowledgeNodeOut(
        id=node.id, title=node.title, description=node.description,
        content=node.content, parent_id=node.parent_id,
        position_x=node.position_x, position_y=node.position_y,
        sort_order=node.sort_order, status=node.status,
        created_at=node.created_at, updated_at=node.updated_at,
        children=[],
        files=[KnowledgeFileOut.model_validate(f) for f in files],
    )


# ── 坐标批量保存（必须在 {node_id} 通配路由之前注册，否则会被 /knowledge-nodes/{node_id} 拦截） ──

@router.put("/knowledge-nodes/positions")
def save_positions(
    data: PositionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """批量保存节点坐标"""
    for item in data.positions:
        node_id = item.get("id")
        x = item.get("x")
        y = item.get("y")
        if not node_id:
            continue
        db.query(KnowledgeNode).filter(KnowledgeNode.id == node_id).update(
            {"position_x": x, "position_y": y}, synchronize_session=False
        )
    db.commit()
    return {"ok": True}


# ── 管理端 CRUD ──

@router.post("/knowledge-nodes", response_model=KnowledgeNodeOut)
def create_knowledge_node(
    data: KnowledgeNodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    node = KnowledgeNode(
        id=str(uuid.uuid4()),
        title=data.title,
        description=data.description,
        content=data.content,
        parent_id=data.parent_id,
        sort_order=data.sort_order,
        status=data.status,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="knowledge", action="create", resource_type="知识",
        resource_name=node.title, description=f"{current_user.name} 创建了知识节点「{node.title}」",
        level="info",
    )
    return KnowledgeNodeOut(
        id=node.id, title=node.title, description=node.description,
        content=node.content, parent_id=node.parent_id,
        position_x=node.position_x, position_y=node.position_y,
        sort_order=node.sort_order, status=node.status,
        created_at=node.created_at, updated_at=node.updated_at,
        children=[], files=[],
    )


@router.put("/knowledge-nodes/{node_id}", response_model=KnowledgeNodeOut)
def update_knowledge_node(
    node_id: str,
    data: KnowledgeNodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    node = db.query(KnowledgeNode).filter(KnowledgeNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="知识节点不存在")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    db.commit()
    db.refresh(node)
    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="knowledge", action="update", resource_type="知识",
        resource_name=node.title, description=f"{current_user.name} 编辑了知识节点「{node.title}」",
        level="info",
    )
    files = (
        db.query(KnowledgeFile)
        .filter(KnowledgeFile.node_id == node_id)
        .order_by(KnowledgeFile.sort_order)
        .all()
    )
    return KnowledgeNodeOut(
        id=node.id, title=node.title, description=node.description,
        content=node.content, parent_id=node.parent_id,
        position_x=node.position_x, position_y=node.position_y,
        sort_order=node.sort_order, status=node.status,
        created_at=node.created_at, updated_at=node.updated_at,
        children=[],
        files=[KnowledgeFileOut.model_validate(f) for f in files],
    )


@router.delete("/knowledge-nodes/{node_id}")
def delete_knowledge_node(
    node_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除知识节点（含所有后代节点及其课件文件）。

    性能修复：原先用「每个节点查一次子节点」的递归方式收集 ID（N+1 查询），
    且不清理 PPT 转换出的 PDF。现一次性加载节点表在内存中遍历，并复用统一的
    文件清理逻辑。
    """
    node = db.query(KnowledgeNode).filter(KnowledgeNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="知识节点不存在")

    # 一次性加载全部节点，在内存中收集子树 ID（避免逐层查库）
    all_nodes = db.query(KnowledgeNode).all()
    children_map: dict[str, list[str]] = {}
    for n in all_nodes:
        if n.parent_id:
            children_map.setdefault(n.parent_id, []).append(n.id)

    all_ids: list[str] = []
    stack = [node_id]
    seen: set[str] = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        all_ids.append(cur)
        stack.extend(children_map.get(cur, []))

    # 清理磁盘文件（含 PPT 转换出的 PDF）
    files = db.query(KnowledgeFile).filter(KnowledgeFile.node_id.in_(all_ids)).all()
    for f in files:
        _remove_knowledge_file_from_disk(f)

    # 删除文件记录
    db.query(KnowledgeFile).filter(KnowledgeFile.node_id.in_(all_ids)).delete(
        synchronize_session=False
    )

    # 删除子节点（深度优先，叶子在前，避免自引用外键约束问题）
    for nid in all_ids:
        if nid == node_id:
            continue
        db.query(KnowledgeNode).filter(KnowledgeNode.id == nid).delete(
            synchronize_session=False
        )

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="knowledge", action="delete", resource_type="知识",
        resource_name=node.title, description=f"{current_user.name} 删除了知识节点「{node.title}」",
        level="warning",
    )
    db.delete(node)
    db.commit()
    return {"ok": True}


# ── 文件管理 ──

def _get_ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


@router.post("/knowledge-nodes/{node_id}/files")
async def upload_knowledge_file(
    node_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """上传课件文件"""
    node = db.query(KnowledgeNode).filter(KnowledgeNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="知识节点不存在")

    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    ext = _get_ext(file.filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: .{ext}，支持: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    file_size = 0
    with open(filepath, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
            file_size += len(chunk)
            if file_size > MAX_FILE_SIZE:
                f.close()
                os.remove(filepath)
                raise HTTPException(status_code=400, detail=f"文件过大，最大支持 {MAX_FILE_SIZE // 1024 // 1024}MB")

    max_order = (
        db.query(KnowledgeFile)
        .filter(KnowledgeFile.node_id == node_id)
        .count()
    )
    knowledge_file = KnowledgeFile(
        id=str(uuid.uuid4()),
        node_id=node_id,
        original_name=file.filename,
        obs_key=filename,
        file_size=file_size,
        file_type=ext,
        sort_order=max_order,
    )
    db.add(knowledge_file)
    db.commit()
    db.refresh(knowledge_file)

    # PPT/PPTX 自动转 PDF
    if ext in ("ppt", "pptx"):
        try:
            _convert_to_pdf(filepath, ext)
        except Exception:
            pass  # 转换失败不影响上传

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="knowledge", action="upload", resource_type="知识文件",
        resource_name=file.filename, description=f"{current_user.name} 上传了文件「{file.filename}」到「{node.title}」",
        level="info",
    )
    return KnowledgeFileOut.model_validate(knowledge_file)


@router.delete("/knowledge-files/{file_id}")
def delete_knowledge_file(
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """删除课件文件"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    # 删除磁盘文件（含 PPT/PPTX 转换后的 PDF）
    _remove_knowledge_file_from_disk(knowledge_file)

    write_log(
        db=db, operator=current_user.name, operator_id=current_user.id,
        category="knowledge", action="delete", resource_type="知识文件",
        resource_name=knowledge_file.original_name,
        description=f"{current_user.name} 删除了文件「{knowledge_file.original_name}」",
        level="warning",
    )
    db.delete(knowledge_file)
    db.commit()
    return {"ok": True}


# ── 管理端文件下载 / 预览 ──

def _get_preview_filepath(knowledge_file: KnowledgeFile) -> str:
    """获取预览文件路径：PPTX/PPT 返回转换后的 PDF，其他返回原文件"""
    ext = _get_ext(knowledge_file.original_name)
    if ext in ("ppt", "pptx"):
        original_path = os.path.join(UPLOAD_DIR, knowledge_file.obs_key)
        pdf_path = os.path.splitext(original_path)[0] + ".pdf"
        if os.path.exists(pdf_path):
            return pdf_path
    return os.path.join(UPLOAD_DIR, knowledge_file.obs_key)


@router.get("/knowledge-files/{file_id}/preview")
def admin_preview_file(
    file_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理端：预览文件（PPTX 自动返回转后的 PDF）"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    filepath = _get_preview_filepath(knowledge_file)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = _get_ext(os.path.basename(filepath))
    # 简易 MIME
    mime_map = {
        "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml",
        "webp": "image/webp",
    }
    media_type = mime_map.get(ext, "application/octet-stream")
    return FileResponse(filepath, media_type=media_type)


@router.get("/knowledge-files/{file_id}/download")
def admin_download_knowledge_file(
    file_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理端：下载课件文件"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    filepath = os.path.join(UPLOAD_DIR, knowledge_file.obs_key)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = _get_ext(knowledge_file.original_name)
    mime_map = {
        "pdf": "application/pdf",
        "ppt": "application/vnd.ms-powerpoint",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "html": "text/html",
        "htm": "text/html",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "svg": "image/svg+xml",
        "webp": "image/webp",
        "txt": "text/plain",
        "md": "text/markdown",
        "csv": "text/csv",
    }
    media_type = mime_map.get(ext, "application/octet-stream")

    return FileResponse(
        filepath,
        media_type=media_type,
        filename=knowledge_file.original_name,
    )


# ── PPT / PPTX 文字提取 ──

def _extract_pptx_text(filepath: str) -> str:
    """从 PPTX 文件中提取所有幻灯片的文字"""
    if not HAS_PPTX_LIB:
        return "(服务器未安装 python-pptx 库，无法提取 PPT 文字)"
    try:
        prs = PptxPresentation(filepath)
        slides_text: list[str] = []
        for i, slide in enumerate(prs.slides, 1):
            lines: list[str] = []
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text = para.text.strip()
                        if text:
                            lines.append(text)
            if lines:
                slides_text.append(f"── 第 {i} 页 ──\n" + "\n".join(lines))
        return "\n\n".join(slides_text) if slides_text else "(此 PPT 无可提取的文字内容)"
    except Exception as e:
        return f"(PPT 解析失败: {e})"


def _extract_text_for_file(filepath: str, ext: str) -> str:
    """根据扩展名提取文件文字"""
    if ext in ("pptx", "ppt"):
        return _extract_pptx_text(filepath)
    # 普通文本文件直接读
    if ext in ("txt", "md", "csv", "json", "xml", "yaml", "yml", "log"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return "(无法读取文件)"
    return "(此文件类型不支持文字提取)"


@router.get("/knowledge-files/{file_id}/text")
def admin_extract_file_text(
    file_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """管理端：提取文件文字内容（用于 PPT 等格式的预览）"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    filepath = os.path.join(UPLOAD_DIR, knowledge_file.obs_key)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = _get_ext(knowledge_file.original_name)
    text = _extract_text_for_file(filepath, ext)
    return {"text": text, "file_type": ext}


# ── 学员端 API ──

@router.get("/student/knowledge-nodes", response_model=list[KnowledgeNodeOut])
def student_knowledge_nodes(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """学员端：获取已发布的知识节点树"""
    all_nodes = (
        db.query(KnowledgeNode)
        .filter(KnowledgeNode.status == "published")
        .order_by(KnowledgeNode.sort_order)
        .all()
    )
    node_ids = [n.id for n in all_nodes]
    files_map = _get_files_by_node(db, node_ids)
    return build_node_tree(all_nodes, files_map)


@router.get("/student/knowledge-nodes/{node_id}", response_model=KnowledgeNodeOut)
def student_knowledge_node_detail(
    node_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """学员端：获取单个知识节点详情"""
    node = db.query(KnowledgeNode).filter(
        KnowledgeNode.id == node_id,
        KnowledgeNode.status == "published",
    ).first()
    if not node:
        raise HTTPException(status_code=404, detail="知识节点不存在")
    files = (
        db.query(KnowledgeFile)
        .filter(KnowledgeFile.node_id == node_id)
        .order_by(KnowledgeFile.sort_order)
        .all()
    )
    return KnowledgeNodeOut(
        id=node.id, title=node.title, description=node.description,
        content=node.content, parent_id=node.parent_id,
        position_x=node.position_x, position_y=node.position_y,
        sort_order=node.sort_order, status=node.status,
        created_at=node.created_at, updated_at=node.updated_at,
        children=[],
        files=[KnowledgeFileOut.model_validate(f) for f in files],
    )


@router.get("/student/knowledge-files/{file_id}/text")
def student_extract_file_text(
    file_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """学员端：提取文件文字内容"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    filepath = os.path.join(UPLOAD_DIR, knowledge_file.obs_key)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = _get_ext(knowledge_file.original_name)
    text = _extract_text_for_file(filepath, ext)
    return {"text": text, "file_type": ext}


@router.get("/student/knowledge-files/{file_id}/preview")
def student_preview_file(
    file_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """学员端：预览文件（PPTX 自动返回转后的 PDF）"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    filepath = _get_preview_filepath(knowledge_file)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = _get_ext(os.path.basename(filepath))
    mime_map = {
        "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml",
        "webp": "image/webp",
    }
    media_type = mime_map.get(ext, "application/octet-stream")
    return FileResponse(filepath, media_type=media_type)


@router.get("/student/knowledge-files/{file_id}/download")
def download_knowledge_file(
    file_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """学员端：下载课件文件"""
    knowledge_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not knowledge_file:
        raise HTTPException(status_code=404, detail="文件不存在")

    filepath = os.path.join(UPLOAD_DIR, knowledge_file.obs_key)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已丢失")

    # 确定 MIME 类型
    ext = _get_ext(knowledge_file.original_name)
    mime_map = {
        "pdf": "application/pdf",
        "ppt": "application/vnd.ms-powerpoint",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "html": "text/html",
        "htm": "text/html",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "svg": "image/svg+xml",
        "webp": "image/webp",
        "txt": "text/plain",
        "md": "text/markdown",
        "csv": "text/csv",
    }
    media_type = mime_map.get(ext, "application/octet-stream")

    return FileResponse(
        filepath,
        media_type=media_type,
        filename=knowledge_file.original_name,
    )