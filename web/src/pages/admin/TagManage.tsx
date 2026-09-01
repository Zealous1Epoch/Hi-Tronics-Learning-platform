import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface TagItem {
  id: string; name: string; parent_id: string | null;
  sort_order: number; children: TagItem[];
}

export default function TagManage() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const fetchTags = async () => {
    const data = await api<TagItem[]>("/question-tags/tree");
    setTags(data);
    setLoading(false);
  };

  useEffect(() => { fetchTags(); }, []);

  const handleCreate = async () => {
    if (!newTagName.trim()) return;
    await api("/question-tags", {
      method: "POST",
      body: JSON.stringify({ name: newTagName.trim(), parent_id: selectedParent }),
    });
    setNewTagName("");
    setSelectedParent(null);
    fetchTags();
  };

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) return;
    await api(`/question-tags/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: editingName.trim() }),
    });
    setEditingId(null);
    setEditingName("");
    fetchTags();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此标签将同时删除子标签，确定？")) return;
    await api(`/question-tags/${id}`, { method: "DELETE" });
    fetchTags();
  };

  const startEdit = (tag: TagItem) => {
    setEditingId(tag.id);
    setEditingName(tag.name);
  };

  // 递归渲染标签树
  const renderTagTree = (items: TagItem[], depth: number = 0) => {
    return items.map((tag) => (
      <div key={tag.id}>
        <div className="flex items-center justify-between py-2 px-3 hover:bg-bg-layout/50 rounded group"
          style={{ paddingLeft: `${16 + depth * 24}px` }}>
          {editingId === tag.id ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text" value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUpdate(tag.id)}
                className="border border-border rounded-md px-2 py-0.5 text-sm flex-1"
                autoFocus
              />
              <button onClick={() => handleUpdate(tag.id)} className="text-xs text-primary hover:underline">保存</button>
              <button onClick={() => setEditingId(null)} className="text-xs text-text-secondary hover:underline">取消</button>
            </div>
          ) : (
            <>
              <span className="text-sm">{tag.name}</span>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setSelectedParent(tag.id)} className="text-xs text-primary hover:underline">添加子标签</button>
                <button onClick={() => startEdit(tag)} className="text-xs text-text-secondary hover:underline">编辑</button>
                <button onClick={() => handleDelete(tag.id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </>
          )}
        </div>
        {tag.children.length > 0 && renderTagTree(tag.children, depth + 1)}
      </div>
    ));
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">标签管理</h2>

      <div className="grid grid-cols-2 gap-6">
        {/* 标签列表 */}
        <div className="bg-bg-base rounded-lg border border-border">
          <div className="px-4 py-3 border-b border-border font-bold text-sm">标签库</div>
          {tags.length === 0 ? (
            <div className="p-8 text-center text-text-secondary text-sm">暂无标签</div>
          ) : (
            <div className="py-1">{renderTagTree(tags)}</div>
          )}
        </div>

        {/* 添加标签 */}
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">
            {selectedParent ? "添加子标签" : "添加根标签"}
          </h3>
          {selectedParent && (
            <p className="text-xs text-text-secondary mb-2">
              父标签: {findTagName(tags, selectedParent)}
              <button onClick={() => setSelectedParent(null)} className="ml-2 text-primary hover:underline">清除</button>
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text" value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="输入标签名称"
              className="flex-1 border border-border rounded-md px-3 py-2 text-sm"
            />
            <button onClick={handleCreate}
              className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light">
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 辅助函数：从树中查找标签名
function findTagName(tree: TagItem[], id: string): string {
  for (const t of tree) {
    if (t.id === id) return t.name;
    const found = findTagName(t.children, id);
    if (found) return found;
  }
  return "";
}