"""知识节点管理路由"""

import uuid
from app.services.log_service import write_log
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.knowledge_node import KnowledgeNode
from app.schemas.knowledge_node import KnowledgeNodeCreate, KnowledgeNodeUpdate, KnowledgeNodeOut
from app.routers.auth import require_admin

router = APIRouter(prefix="/api", tags=["知识节点"])


def build_node_tree(nodes: list[KnowledgeNode], parent_id: str | None = None) -> list[KnowledgeNodeOut]:
    children = [n for n in nodes if n.parent_id == parent_id]
    return [
        KnowledgeNodeOut(
            id=n.id, title=n.title, description=n.description,
            parent_id=n.parent_id, sort_order=n.sort_order,
            created_at=n.created_at, updated_at=n.updated_at,
            children=build_node_tree(nodes, n.id),
        )
        for n in sorted(children, key=lambda x: x.sort_order)
    ]


@router.get("/knowledge-nodes", response_model=list[KnowledgeNodeOut])
def list_knowledge_nodes(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """获取知识节点树"""
    return build_node_tree(db.query(KnowledgeNode).order_by(KnowledgeNode.sort_order).all())


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
        parent_id=data.parent_id,
        sort_order=data.sort_order,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="knowledge", action="create", resource_type="知识", resource_name=node.title if hasattr(node, 'title') else "", description=f"{current_user.name} 创建了知识节点「{node.title}」", level="info")
    return KnowledgeNodeOut(
        id=node.id, title=node.title, description=node.description,
        parent_id=node.parent_id, sort_order=node.sort_order,
        created_at=node.created_at, updated_at=node.updated_at,
        children=[],
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
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="knowledge", action="update", resource_type="知识", resource_name=node.title if hasattr(node, 'title') else "", description=f"{current_user.name} 编辑了知识节点「{node.title}」", level="info")
    return KnowledgeNodeOut(
        id=node.id, title=node.title, description=node.description,
        parent_id=node.parent_id, sort_order=node.sort_order,
        created_at=node.created_at, updated_at=node.updated_at,
        children=[],
    )


@router.delete("/knowledge-nodes/{node_id}")
def delete_knowledge_node(
    node_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    node = db.query(KnowledgeNode).filter(KnowledgeNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="知识节点不存在")
    write_log(db=db, operator=current_user.name, operator_id=current_user.id, category="knowledge", action="delete", resource_type="知识", resource_name=node.title if hasattr(node, 'title') else "", description=f"{current_user.name} 删除了知识节点「{node.title}」", level="warning")
    # 递归删除子节点
    def delete_children(parent_id: str):
        children = db.query(KnowledgeNode).filter(KnowledgeNode.parent_id == parent_id).all()
        for child in children:
            delete_children(child.id)
            db.delete(child)
    delete_children(node_id)
    db.delete(node)
    db.commit()
    return {"ok": True}