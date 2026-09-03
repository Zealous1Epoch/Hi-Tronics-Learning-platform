import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import PaperCreate from "./PaperCreate";
import { ChevronRight, ChevronDown, Plus, Search, Pencil, Trash2 } from "lucide-react";

interface TreeNode {
  id: string; name: string; parent_id: string | null;
  children: TreeNode[];
}
interface PaperItem {
  id: string; title: string; category_id: string | null;
  paper_type: string; total_score: number; status: string;
  mandatory_questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
  created_at: string;
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}

export default function PaperManage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingPaper, setEditingPaper] = useState<PaperItem | null>(null);

  const fetchData = async () => {
    const [treeData, papersData, flatData] = await Promise.all([
      api<TreeNode[]>("/question-categories/tree"),
      api<PaperItem[]>("/papers"),
      api<FlatCategory[]>("/question-categories/flat"),
    ]);
    setTree(treeData);
    setPapers(papersData);
    setFlatCategories(flatData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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

  const openCreate = () => {
    setEditingPaper(null);
    setShowCreate(true);
  };

  const filteredPapers = selectedId
    ? papers.filter(p => p.category_id === selectedId)
    : papers;

  const getQuestionCount = (p: PaperItem) => {
    if (p.paper_type === "fixed") {
      return p.mandatory_questions?.length || 0;
    }
    const random = p.random_rules?.reduce((sum, r) => sum + r.count, 0) || 0;
    return random;
  };

  const getCategoryPath = (catId: string | null): string => {
    if (!catId) return "-";
    const parts: string[] = [];
    let current = flatCategories.find(c => c.id === catId);
    while (current) {
      parts.unshift(current.name);
      current = current.parent_id ? flatCategories.find(c => c.id === current.parent_id) : undefined;
    }
    return parts.join(" - ");
  };

  const filterTree = (nodes: TreeNode[], term: string): TreeNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    const result: TreeNode[] = [];
    for (const node of nodes) {
      const filteredChildren = filterTree(node.children, term);
      if (node.name.toLowerCase().includes(lower) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
    return result;
  };

  const filteredTree = searchText ? filterTree(tree, searchText) : tree;

  useEffect(() => {
    if (!searchText) return;
    const collectIds = (nodes: TreeNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };
    setExpandedIds(new Set(collectIds(filteredTree)));
  }, [searchText]);

  const renderTree = (nodes: TreeNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              isSelected ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              setSelectedId(node.id);
              if (hasChildren) {
                setExpandedIds(prev => {
                  const next = new Set(prev);
                  next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                  return next;
                });
              }
            }}
          >
            {hasChildren ? (
              <button
                onClick={e => { e.stopPropagation(); toggleExpand(node.id); }}
                className="p-0.5 shrink-0 text-text-secondary"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4 pb-3 border-b border-border">试卷管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧分类树 */}
        <div className="w-56 shrink-0 pr-4 border-r border-border">
          <div
            onClick={() => setSelectedId(null)}
            className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium mb-2 ${
              selectedId === null ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-bg-layout"
            }`}
          >
            全部试卷
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text" placeholder="搜索分类..."
              value={searchText} onChange={e => setSearchText(e.target.value)}
              className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
            />
          </div>
          <div className="bg-bg-base rounded-lg border border-border max-h-[calc(100vh-200px)] overflow-y-auto">
            {filteredTree.length === 0 ? (
              <div className="p-4 text-center text-sm text-text-secondary">暂无分类</div>
            ) : (
              <div className="py-1">{renderTree(filteredTree)}</div>
            )}
          </div>
        </div>

        {/* 右侧试卷列表 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">
              {selectedId ? getCategoryPath(selectedId) : "全部试卷"}
            </span>
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light"
            >
              <Plus size={14} className="inline mr-1" />新增试卷
            </button>
          </div>

          {filteredPapers.length === 0 ? (
            <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
              暂无试卷
            </div>
          ) : (
            <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm table-fixed">
                <thead className="bg-bg-layout border-b border-border">
                  <tr>
                    <th className="text-center px-4 py-3 font-medium text-text-secondary">试卷名称</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-16">类型</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-40">类别</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-16">题目数</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-16">总分</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-20">状态</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-32">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPapers.map(p => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                      <td className="px-4 py-3 truncate font-medium text-center">{p.title}</td>
                      <td className="px-3 py-3 text-center text-text-secondary whitespace-nowrap">
                        {p.paper_type === "fixed" ? "固定" : "随机"}
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary whitespace-nowrap truncate">
                        {getCategoryPath(p.category_id)}
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary whitespace-nowrap">{getQuestionCount(p)}</td>
                      <td className="px-3 py-3 text-center text-text-secondary whitespace-nowrap">{p.total_score}</td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          p.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-bg-layout text-text-secondary"
                        }`}>
                          {p.status === "published" ? "已发布" : "草稿"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <button onClick={() => openEdit(p)} className="text-xs text-primary border border-primary rounded px-1.5 py-0.5 hover:bg-primary/5 mr-1">编辑</button>
                        <button onClick={() => handleDeletePaper(p.id)} className="text-xs text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <PaperCreate
          paper={editingPaper}
          defaultCategoryId={selectedId}
          onDone={handleCreateDone}
          onClose={() => { setShowCreate(false); setEditingPaper(null); }}
        />
      )}
    </div>
  );
}