import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import QuestionManage from "./QuestionManage";
import { ChevronRight, ChevronDown, Plus, Search, Pencil, Trash2 } from "lucide-react";

interface TreeNode {
  id: string; name: string; parent_id: string | null;
  sort_order: number; children: TreeNode[];
}

interface CategoryStats {
  id: string; name: string; is_leaf: boolean; child_count: number;
  single_choice: number; multi_choice: number; true_false: number;
  fill_blank: number; essay: number; total_count: number;
  created_at: string | null;
}

const tabs = [
  { key: "manage", label: "题库管理" },
  { key: "questions", label: "试题" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "问答题",
};

const STAT_COLORS: Record<string, string> = {
  single_choice: "border border-border text-text-secondary",
  multi_choice: "border border-border text-text-secondary",
  true_false: "border border-border text-text-secondary",
  fill_blank: "border border-border text-text-secondary",
  essay: "border border-border text-text-secondary",
  total: "border border-border text-text-secondary font-medium",
};

export default function QuestionBank() {
  const [activeTab, setActiveTab] = useState<TabKey>("manage");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [stats, setStats] = useState<CategoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const [addingChildUnder, setAddingChildUnder] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState("");

  const fetchTree = async () => {
    const data = await api<TreeNode[]>("/question-categories/tree");
    setTree(data);
    setLoading(false);
  };

  useEffect(() => { fetchTree(); }, []);

  // 选中节点变化时加载统计
  useEffect(() => {
    if (!selectedId) { setStats(null); return; }
    api<CategoryStats>(`/question-categories/${selectedId}/stats`).then(setStats);
  }, [selectedId]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRename = async () => {
    if (!editingName.trim() || !editingId) return;
    await api(`/question-categories/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({ name: editingName.trim() }),
    });
    setEditingId(null);
    setEditingName("");
    fetchTree();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此分类将同时删除其子分类和所有题目，确定？")) return;
    await api(`/question-categories/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    fetchTree();
  };

  const handleAddRoot = async () => {
    if (!newRootName.trim()) return;
    await api("/question-categories", {
      method: "POST",
      body: JSON.stringify({ name: newRootName.trim() }),
    });
    setNewRootName("");
    setAddingRoot(false);
    fetchTree();
  };

  const handleAddChild = async (parentId: string) => {
    if (!newChildName.trim()) return;
    await api("/question-categories", {
      method: "POST",
      body: JSON.stringify({ name: newChildName.trim(), parent_id: parentId }),
    });
    setNewChildName("");
    setAddingChildUnder(null);
    fetchTree();
  };

  const startAddChild = () => {
    if (!selectedId) return;
    setNewChildName("");
    setAddingChildUnder(selectedId);
    setExpandedIds(prev => new Set(prev).add(selectedId));
  };

  // 搜索过滤树：匹配节点保留，同时保留其祖先链
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

  // 搜索时自动展开所有匹配节点
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
      const isAddingChild = addingChildUnder === node.id;

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
                    if (next.has(node.id)) {
                      next.delete(node.id);
                    } else {
                      next.add(node.id);
                    }
                    return next;
                  });
                }
              }}
          >
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
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
          {isAddingChild && (
            <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}>
              <span className="w-5 shrink-0" />
              <input
                type="text"
                value={newChildName}
                onChange={(e) => setNewChildName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddChild(node.id);
                  if (e.key === "Escape") { setAddingChildUnder(null); setNewChildName(""); }
                }}
                placeholder="输入名称..."
                className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                autoFocus
              />
            </div>
          )}
        </div>
      );
    });
  };

  const formatTime = (t: string | null) => {
    if (!t) return "-";
    return new Date(t).toLocaleString("zh-CN", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">试题管理</h2>

      <div className="flex gap-4">
        {/* 左侧树 */}
        <div className="w-56 shrink-0">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text" placeholder="搜索题库名..."
              value={searchText} onChange={(e) => setSearchText(e.target.value)}
              className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
            />
          </div>
          <div className="bg-bg-base rounded-lg border border-border max-h-[calc(100vh-240px)] overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-text-secondary">加载中...</p>
            ) : filteredTree.length === 0 ? (
              <div className="p-4 text-center text-sm text-text-secondary">
                {searchText ? "无匹配结果" : "暂无分类，点击下方按钮添加"}
              </div>
            ) : (
              <div className="py-1">
                {renderTree(filteredTree)}
                {addingRoot && (
                  <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: 8 }}>
                    <span className="w-5 shrink-0" />
                    <input
                      type="text"
                      value={newRootName}
                      onChange={(e) => setNewRootName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddRoot();
                        if (e.key === "Escape") { setAddingRoot(false); setNewRootName(""); }
                      }}
                      placeholder="输入名称..."
                      className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => { setAddingRoot(true); setNewRootName(""); }}
            className="mt-2 w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-primary border border-dashed border-primary/30 rounded-md hover:bg-primary/5"
          >
            <Plus size={12} /> 添加根分类
          </button>
          {selectedId && (
            <div className="mt-1.5 space-y-1.5">
              <button
                onClick={startAddChild}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary-light"
              >
                <Plus size={12} /> 添加子节点
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { setEditingId(selectedId); setEditingName(stats?.name || ""); }}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-border rounded-md hover:bg-bg-layout"
                >
                  <Pencil size={12} /> 改名
                </button>
                <button
                  onClick={() => handleDelete(selectedId)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-red-200 text-red-500 rounded-md hover:bg-red-50"
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-3 mb-4">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2 rounded-md text-sm ${
                  activeTab === t.key
                    ? "bg-primary text-white"
                    : "border border-border text-text-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab 1: 题库管理 */}
          {activeTab === "manage" && (
            <div>
              {!selectedId ? (
                <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                  请在左侧选择一个题库
                </div>
              ) : stats ? (
                <div className="space-y-4">
                  {/* 统计面板 */}
                  <div className="bg-bg-base rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-sm">{stats.name}</h3>
                      <span className="text-xs text-text-secondary">
                        {stats.is_leaf ? "叶子题库" : `容器节点 / ${stats.child_count} 个子节点`}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {(["single_choice", "multi_choice", "true_false", "fill_blank", "essay"] as const).map(type => (
                        <div key={type} className={`flex items-center justify-between px-3 py-2 rounded text-xs ${STAT_COLORS[type]}`}>
                          <span>{TYPE_LABELS[type]}</span>
                          <span className="font-bold">{stats[type]}</span>
                        </div>
                      ))}
                      <div className={`flex items-center justify-between px-3 py-2 rounded text-xs ${STAT_COLORS.total}`}>
                        <span>合计</span>
                        <span className="font-bold">{stats.total_count}</span>
                      </div>
                    </div>
                    <p className="text-xs text-text-secondary">
                      创建时间: {formatTime(stats.created_at)}
                    </p>
                  </div>

                  {/* 改名输入框 */}
                  {editingId && (
                    <div className="flex items-center gap-2 bg-bg-base rounded-lg border border-border p-3">
                      <input
                        type="text" value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleRename()}
                        className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm"
                        autoFocus
                      />
                      <button onClick={handleRename} className="px-3 py-1.5 text-xs bg-primary text-white rounded-md">保存</button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs border border-border rounded-md">取消</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                  加载中...
                </div>
              )}
            </div>
          )}

          {/* Tab 2: 试题 */}
          {activeTab === "questions" && (
            <div>
              {!selectedId ? (
                <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                  请在左侧选择一个题库
                </div>
              ) : stats && !stats.is_leaf ? (
                <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                  请选择子题库查看试题
                </div>
              ) : (
                <QuestionManage categoryId={selectedId} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}