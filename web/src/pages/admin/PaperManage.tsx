import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import PaperCreate from "./PaperCreate";

interface CategoryNode {
  id: string; name: string; parent_id: string | null;
  children: CategoryNode[];
}
interface PaperItem {
  id: string; title: string; category_id: string | null;
  paper_type: string; total_score: number; status: string;
  mandatory_questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
  created_at: string;
}

export default function PaperManage() {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newCatName, setNewCatName] = useState("");
  const [catParentId, setCatParentId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPaper, setEditingPaper] = useState<PaperItem | null>(null);

  const fetchData = async () => {
    const [cats, papersData] = await Promise.all([
      api<CategoryNode[]>("/paper-categories/tree"),
      api<PaperItem[]>("/papers"),
    ]);
    setCategories(cats);
    setPapers(papersData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const handleCreateCat = async () => {
    if (!newCatName.trim()) return;
    await api("/paper-categories", {
      method: "POST",
      body: JSON.stringify({ name: newCatName.trim(), parent_id: catParentId }),
    });
    setNewCatName("");
    setCatParentId(null);
    fetchData();
  };

  const handleDeleteCat = async (id: string) => {
    if (!confirm("删除此分类将同时删除子分类，确定？")) return;
    await api(`/paper-categories/${id}`, { method: "DELETE" });
    if (selectedCategory === id) setSelectedCategory(null);
    fetchData();
  };

  const handleDeletePaper = async (id: string) => {
    if (!confirm("确定删除此试卷？")) return;
    await api(`/papers/${id}`, { method: "DELETE" });
    fetchData();
  };

  const handleCreateDone = () => {
    setShowCreate(false);
    setEditingPaper(null);
    fetchData();
  };

  const openEdit = (paper: PaperItem) => {
    setEditingPaper(paper);
    setShowCreate(true);
  };

  const filteredPapers = selectedCategory
    ? papers.filter((p) => p.category_id === selectedCategory)
    : papers;

  const getQuestionCount = (p: PaperItem) => {
    if (p.paper_type === "fixed") {
      return p.mandatory_questions?.length || 0;
    }
    const mandatory = p.mandatory_questions?.length || 0;
    const random = p.random_rules?.reduce((sum, r) => sum + r.count, 0) || 0;
    return mandatory + random;
  };

  const renderTree = (nodes: CategoryNode[], depth: number = 0) => {
    return nodes.map((node) => (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1 py-1.5 px-2 rounded text-sm cursor-pointer group hover:bg-bg-layout ${
            selectedCategory === node.id ? "bg-primary/10 text-primary font-medium" : "text-text-secondary"
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            setSelectedCategory(node.id);
            setExpanded((prev) => {
              const next = new Set(prev);
              next.has(node.id) ? next.delete(node.id) : next.add(node.id);
              return next;
            });
          }}
        >
          {node.children.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
              className="text-text-secondary text-xs w-4 flex-shrink-0"
            >
              {expanded.has(node.id) ? "v" : ">"}
            </button>
          )}
          {node.children.length === 0 && <span className="w-4 flex-shrink-0" />}
          <span className="flex-1 truncate">{node.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setCatParentId(node.id); }}
            className="text-xs text-primary hover:underline opacity-0 group-hover:opacity-100 flex-shrink-0"
          >
            +
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteCat(node.id); }}
            className="text-xs text-red-500 hover:underline opacity-0 group-hover:opacity-100 flex-shrink-0"
          >
            x
          </button>
        </div>
        {expanded.has(node.id) && renderTree(node.children, depth + 1)}
      </div>
    ));
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">试卷管理</h2>

      <div className="flex gap-4">
        {/* 左侧分类树 */}
        <div className="w-52 flex-shrink-0">
          <div className="bg-bg-base rounded-lg border border-border">
            <div className="px-3 py-2 border-b border-border font-bold text-sm">试卷分类</div>
            <div className="py-1 max-h-[60vh] overflow-y-auto">
              {categories.length === 0 ? (
                <p className="p-4 text-center text-text-secondary text-xs">暂无分类</p>
              ) : (
                renderTree(categories)
              )}
            </div>
            <div className="px-2 py-2 border-t border-border">
              <div className="flex gap-1">
                <input
                  type="text" value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateCat()}
                  placeholder={catParentId ? "子分类名称..." : "新分类名称..."}
                  className="flex-1 border border-border rounded-md px-2 py-1 text-xs"
                />
                <button
                  onClick={handleCreateCat}
                  className="px-2 py-1 bg-primary text-white rounded-md text-xs flex-shrink-0"
                >
                  添加
                </button>
              </div>
              {catParentId && (
                <p className="text-xs text-text-secondary mt-1">
                  将添加为子分类
                  <button onClick={() => setCatParentId(null)} className="text-primary ml-1 hover:underline">取消</button>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 右侧试卷列表 */}
        <div className="flex-1 min-w-0">
          <div className="bg-bg-base rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="font-bold text-sm">
                {selectedCategory
                  ? `${findCatName(categories, selectedCategory)} - 试卷列表`
                  : "全部试卷"}
              </span>
              <button
                onClick={() => { setEditingPaper(null); setShowCreate(true); }}
                className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light"
              >
                新增试卷
              </button>
            </div>

            {filteredPapers.length === 0 ? (
              <div className="p-12 text-center text-text-secondary text-sm">
                暂无试卷，点击右上角新增
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-bg-layout border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 text-text-secondary font-normal">试卷名称</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-normal w-20">类型</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-normal w-16">题目数</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-normal w-16">总分</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-normal w-16">状态</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-normal w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPapers.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                      <td className="px-4 py-3 font-medium">{p.title}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        {p.paper_type === "fixed" ? "固定" : "随机"}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{getQuestionCount(p)}</td>
                      <td className="px-4 py-3 text-text-secondary">{p.total_score}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          p.status === "published" ? "bg-green-50 text-green-700" : "bg-border text-text-secondary"
                        }`}>
                          {p.status === "published" ? "已发布" : "草稿"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => openEdit(p)} className="text-xs text-primary hover:underline mr-3">编辑</button>
                        <button onClick={() => handleDeletePaper(p.id)} className="text-xs text-red-500 hover:underline">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* 创建/编辑向导 */}
      {showCreate && (
        <PaperCreate
          paper={editingPaper}
          categories={categories}
          onDone={handleCreateDone}
          onClose={() => { setShowCreate(false); setEditingPaper(null); }}
        />
      )}
    </div>
  );
}

function findCatName(tree: CategoryNode[], id: string): string {
  for (const c of tree) {
    if (c.id === id) return c.name;
    const found = findCatName(c.children, id);
    if (found) return found;
  }
  return "未知分类";
}