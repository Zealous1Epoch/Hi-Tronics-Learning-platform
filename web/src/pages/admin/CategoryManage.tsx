import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface CategoryItem {
  id: string; name: string; parent_id: string | null;
  sort_order: number; children: CategoryItem[];
}

export default function CategoryManage() {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const fetchCategories = async () => {
    const data = await api<CategoryItem[]>("/question-categories/tree");
    setCategories(data);
    setLoading(false);
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleCreate = async () => {
    if (!newCategoryName.trim()) return;
    await api("/question-categories", {
      method: "POST",
      body: JSON.stringify({ name: newCategoryName.trim(), parent_id: selectedParent }),
    });
    setNewCategoryName("");
    setSelectedParent(null);
    fetchCategories();
  };

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) return;
    await api(`/question-categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: editingName.trim() }),
    });
    setEditingId(null);
    setEditingName("");
    fetchCategories();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此分类将同时删除子分类，确定？")) return;
    await api(`/question-categories/${id}`, { method: "DELETE" });
    fetchCategories();
  };

  const startEdit = (cat: CategoryItem) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const renderCategoryTree = (items: CategoryItem[], depth: number = 0) => {
    return items.map((cat) => (
      <div key={cat.id}>
        <div className="flex items-center justify-between py-2 px-3 hover:bg-bg-layout/50 rounded group"
          style={{ paddingLeft: `${16 + depth * 24}px` }}>
          {editingId === cat.id ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text" value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUpdate(cat.id)}
                className="border border-border rounded-md px-2 py-0.5 text-sm flex-1"
                autoFocus
              />
              <button onClick={() => handleUpdate(cat.id)} className="text-xs text-primary hover:underline">保存</button>
              <button onClick={() => setEditingId(null)} className="text-xs text-text-secondary hover:underline">取消</button>
            </div>
          ) : (
            <>
              <span className="text-sm">{cat.name}</span>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setSelectedParent(cat.id)} className="text-xs text-primary hover:underline">添加子分类</button>
                <button onClick={() => startEdit(cat)} className="text-xs text-text-secondary hover:underline">编辑</button>
                <button onClick={() => handleDelete(cat.id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </>
          )}
        </div>
        {cat.children.length > 0 && renderCategoryTree(cat.children, depth + 1)}
      </div>
    ));
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">题库分类</h2>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-bg-base rounded-lg border border-border">
          <div className="px-4 py-3 border-b border-border font-bold text-sm">分类列表</div>
          {categories.length === 0 ? (
            <div className="p-8 text-center text-text-secondary text-sm">暂无分类</div>
          ) : (
            <div className="py-1">{renderCategoryTree(categories)}</div>
          )}
        </div>

        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">
            {selectedParent ? "添加子分类" : "添加根分类"}
          </h3>
          {selectedParent && (
            <p className="text-xs text-text-secondary mb-2">
              父分类: {findCategoryName(categories, selectedParent)}
              <button onClick={() => setSelectedParent(null)} className="ml-2 text-primary hover:underline">清除</button>
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text" value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="输入分类名称"
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

function findCategoryName(tree: CategoryItem[], id: string): string {
  for (const c of tree) {
    if (c.id === id) return c.name;
    const found = findCategoryName(c.children, id);
    if (found) return found;
  }
  return "";
}