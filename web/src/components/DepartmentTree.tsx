import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../lib/api";
import { ChevronRight, ChevronDown, Search, Plus, Pencil, Trash2 } from "lucide-react";

export interface DeptNode {
  id: string;
  name: string;
  parent_id: string | null;
  children: DeptNode[];
}
export interface FlatDept {
  id: string;
  name: string;
  parent_id: string | null;
}

interface DepartmentTreeProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editable?: boolean;
  onTreeChange?: () => void;
  onFlatDeptsReady?: (flatDepts: FlatDept[]) => void;
  onTreeData?: (tree: DeptNode[]) => void;
  allLabel?: string;
}

export default function DepartmentTree({
  selectedId,
  onSelect,
  editable = false,
  onTreeChange,
  onFlatDeptsReady,
  onTreeData,
  allLabel = "全部用户",
}: DepartmentTreeProps) {
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [flatDepts, setFlatDepts] = useState<FlatDept[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [loadingTree, setLoadingTree] = useState(true);

  // 编辑状态（仅 editable 模式使用）
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const [addingChildUnder, setAddingChildUnder] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState("");

  const fetchTree = async () => {
    const [treeData, flatData] = await Promise.all([
      api<DeptNode[]>("/departments"),
      api<FlatDept[]>("/departments/flat"),
    ]);
    setTree(treeData);
    setFlatDepts(flatData);
    setLoadingTree(false);
  };

  useEffect(() => {
    fetchTree();
  }, []);

  // 通知父组件树数据就绪
  useEffect(() => {
    if (onTreeData) onTreeData(tree);
  }, [tree, onTreeData]);

  // 通知父组件 flatDepts 就绪
  useEffect(() => {
    if (flatDepts.length > 0 && onFlatDeptsReady) {
      onFlatDeptsReady(flatDepts);
    }
  }, [flatDepts, onFlatDeptsReady]);

  // 树编辑操作（仅 editable 模式）
  const handleRename = async (deptId: string) => {
    if (!renamingName.trim()) {
      setRenamingId(null);
      return;
    }
    await api(`/departments/${deptId}`, {
      method: "PUT",
      body: JSON.stringify({ name: renamingName.trim() }),
    });
    setRenamingId(null);
    setRenamingName("");
    fetchTree();
    onTreeChange?.();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此部门将同时删除其子部门，确定？")) return;
    await api(`/departments/${id}`, { method: "DELETE" });
    if (selectedId === id) onSelect(null);
    fetchTree();
    onTreeChange?.();
  };

  const handleAddRoot = async () => {
    if (!newRootName.trim()) return;
    await api("/departments", {
      method: "POST",
      body: JSON.stringify({ name: newRootName.trim() }),
    });
    setNewRootName("");
    setAddingRoot(false);
    fetchTree();
    onTreeChange?.();
  };

  const handleAddChild = async (parentId: string) => {
    if (!newChildName.trim()) return;
    await api("/departments", {
      method: "POST",
      body: JSON.stringify({ name: newChildName.trim(), parent_id: parentId }),
    });
    setNewChildName("");
    setAddingChildUnder(null);
    fetchTree();
    onTreeChange?.();
  };

  const startAddChild = () => {
    if (!selectedId) return;
    setNewChildName("");
    setAddingChildUnder(selectedId);
    setExpandedIds((prev) => new Set(prev).add(selectedId));
  };

  // 搜索过滤
  const filterTree = useCallback((nodes: DeptNode[], term: string): DeptNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    const result: DeptNode[] = [];
    for (const node of nodes) {
      const filteredChildren = filterTree(node.children, term);
      if (node.name.toLowerCase().includes(lower) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
    return result;
  }, []);

  const filteredTree = useMemo(
    () => (searchText ? filterTree(tree, searchText) : tree),
    [tree, searchText, filterTree]
  );

  // 搜索时自动展开所有匹配节点
  useEffect(() => {
    if (!searchText) {
      setExpandedIds(new Set());
      return;
    }
    const collectIds = (nodes: DeptNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };
    setExpandedIds(new Set(collectIds(filteredTree)));
  }, [searchText, filteredTree]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelect = (nodeId: string) => {
    onSelect(nodeId);
    setRenamingId(null);
  };

  // 渲染树节点
  const renderTree = (nodes: DeptNode[], depth: number = 0) => {
    return nodes.map((node) => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      const hasChildren = node.children.length > 0;
      const isAddingChild = editable && addingChildUnder === node.id;
      const isRenaming = editable && renamingId === node.id;

      return (
        <div key={node.id}>
          {isRenaming ? (
            <div
              className="flex items-center gap-1 px-2 py-1"
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              <span className="w-5 shrink-0" />
              <input
                type="text"
                value={renamingName}
                onChange={(e) => setRenamingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(node.id);
                  if (e.key === "Escape") {
                    setRenamingId(null);
                    setRenamingName("");
                  }
                }}
                onBlur={() => {
                  if (!renamingName.trim()) {
                    setRenamingId(null);
                    setRenamingName("");
                  }
                }}
                className="k-input flex-1"
                autoFocus
              />
            </div>
          ) : (
            <div
              className={`k-tree-item ${isSelected ? "is-active" : ""}`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              onClick={() => {
                handleSelect(node.id);
                if (hasChildren) {
                  setExpandedIds((prev) => {
                    const next = new Set(prev);
                    next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                    return next;
                  });
                }
              }}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(node.id);
                  }}
                  className="p-0.5 shrink-0 text-text-secondary"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
              {isSelected && !editable && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              )}
            </div>
          )}
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
          {isAddingChild && (
            <div
              className="flex items-center gap-1 px-2 py-1"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
            >
              <span className="w-5 shrink-0" />
              <input
                type="text"
                value={newChildName}
                onChange={(e) => setNewChildName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddChild(node.id);
                  if (e.key === "Escape") {
                    setAddingChildUnder(null);
                    setNewChildName("");
                  }
                }}
                placeholder="输入名称..."
                className="k-input flex-1"
                autoFocus
              />
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <>
      {/* 全部 / 全部学员 头部 */}
      <div
        onClick={() => onSelect(null)}
        className={`k-tree-item mb-2 ${selectedId === null ? "is-active" : ""}`}
      >
        {allLabel}
      </div>

      {/* 搜索框 */}
      <div className="k-search mb-2">
        <Search size={14} />
        <input
          type="text"
          placeholder="搜索部门..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      {/* 树容器 */}
      <div className="k-card max-h-[calc(100vh-240px)] overflow-y-auto">
        {loadingTree ? (
          <p className="k-empty">加载中...</p>
        ) : filteredTree.length === 0 && !(editable && addingRoot) ? (
          <div className="k-empty">
            {searchText
              ? "无匹配结果"
              : editable
                ? "暂无部门，点击下方按钮添加"
                : "暂无部门"}
          </div>
        ) : (
          <div className="py-1">
            {filteredTree.length > 0 && renderTree(filteredTree)}
            {editable && addingRoot && (
              <div
                className="flex items-center gap-1 px-2 py-1"
                style={{ paddingLeft: 8 }}
              >
                <span className="w-5 shrink-0" />
                <input
                  type="text"
                  value={newRootName}
                  onChange={(e) => setNewRootName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddRoot();
                    if (e.key === "Escape") {
                      setAddingRoot(false);
                      setNewRootName("");
                    }
                  }}
                  onBlur={() => {
                    if (!newRootName.trim()) {
                      setAddingRoot(false);
                      setNewRootName("");
                    }
                  }}
                  placeholder="输入名称..."
                  className="k-input flex-1"
                  autoFocus
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 编辑模式按钮组 */}
      {editable && (
        <>
          <button
            onClick={() => {
              setAddingRoot(true);
              setNewRootName("");
            }}
            className="mt-2 w-full k-btn k-btn-default k-btn-sm"
          >
            <Plus size={12} /> 添加部门
          </button>
          {selectedId && (
            <div className="mt-1.5 space-y-1.5">
              <button
                onClick={startAddChild}
                className="w-full k-btn k-btn-primary k-btn-sm"
              >
                <Plus size={12} /> 添加车间
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    const node = flatDepts.find((d) => d.id === selectedId);
                    setRenamingId(selectedId);
                    setRenamingName(node?.name || "");
                  }}
                  className="flex-1 k-btn k-btn-default k-btn-sm"
                >
                  <Pencil size={12} /> 改名
                </button>
                <button
                  onClick={() => handleDelete(selectedId)}
                  className="flex-1 k-btn k-btn-danger k-btn-sm"
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 非编辑模式：清除筛选 */}
      {!editable && selectedId && (
        <button
          onClick={() => onSelect(null)}
          className="k-link mt-2 w-full"
        >
          清除筛选
        </button>
      )}
    </>
  );
}