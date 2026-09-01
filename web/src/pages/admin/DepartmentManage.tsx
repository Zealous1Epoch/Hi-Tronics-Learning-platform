import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface DeptNode {
  id: string;
  name: string;
  parent_id: string | null;
  children: DeptNode[];
}

export default function DepartmentManage() {
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchTree = async () => {
    setLoading(true);
    const data = await api<DeptNode[]>("/departments");
    setTree(data);
    setLoading(false);
  };

  useEffect(() => { fetchTree(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await api("/departments", {
      method: "POST",
      body: JSON.stringify({ name: newName, parent_id: parentId }),
    });
    setNewName("");
    fetchTree();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除？子部门也将一并删除。")) return;
    await api(`/departments/${id}`, { method: "DELETE" });
    fetchTree();
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const renderNode = (node: DeptNode, depth: number = 0) => (
    <div key={node.id}>
      <div
        className="flex items-center gap-2 py-2 px-3 hover:bg-bg-layout rounded group"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        {node.children.length > 0 && (
          <button onClick={() => toggleExpand(node.id)} className="text-text-secondary text-xs w-4">
            {expanded.has(node.id) ? "v" : ">"}
          </button>
        )}
        {node.children.length === 0 && <span className="w-4" />}
        <span className="text-sm">{node.name}</span>
        <button
          onClick={() => { setParentId(node.id); }}
          className="text-xs text-primary hover:underline opacity-0 group-hover:opacity-100 ml-2"
        >
          添加子部门
        </button>
        <button
          onClick={() => handleDelete(node.id)}
          className="text-xs text-red-500 hover:underline opacity-0 group-hover:opacity-100 ml-1"
        >
          删除
        </button>
      </div>
      {expanded.has(node.id) && node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">部门管理</h2>
      <div className="bg-bg-base rounded-lg border border-border">
        <div className="p-4 border-b border-border flex gap-3 items-center">
          <input
            type="text"
            placeholder="新部门名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm w-48"
          />
          {parentId && (
            <span className="text-xs text-text-secondary">
              父级: {parentId}
              <button onClick={() => setParentId(null)} className="text-primary ml-1">取消</button>
            </span>
          )}
          <button
            onClick={handleCreate}
            className="bg-primary text-white px-4 py-1.5 rounded-md text-sm"
          >
            添加部门
          </button>
        </div>
        <div className="py-2">
          {loading ? (
            <p className="text-center py-8 text-text-secondary">加载中...</p>
          ) : tree.length === 0 ? (
            <p className="text-center py-8 text-text-secondary">暂无部门</p>
          ) : (
            tree.map((node) => renderNode(node))
          )}
        </div>
      </div>
    </div>
  );
}