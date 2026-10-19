import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, ChevronDown, Search } from "lucide-react";

export interface TreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  children: TreeNode[];
}

export interface FlatCategory {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order?: number;
}

interface CourseTreeProps {
  tree: TreeNode[];
  flatCategories: FlatCategory[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  rootLabel: string;
  placeholder?: string;
  loading?: boolean;
  emptyText?: string;
  clearFilterText?: string;
  enableDrag?: boolean;
  onReorder?: (dragId: string, targetId: string) => void;
  renderNodeFooter?: (node: TreeNode, depth: number) => React.ReactNode;
  renderTreeFooter?: () => React.ReactNode;
  renderActions?: (selectedId: string | null) => React.ReactNode;
  renderHeader?: () => React.ReactNode;
  /** 树容器高度类名，默认 max-h-[calc(100vh-240px)] */
  treeContainerClass?: string;
  /** 是否显示"全部X"头部，默认 true */
  showHeader?: boolean;
  /** 是否显示搜索框，默认 true */
  showSearch?: boolean;
  /** 是否在挂载时默认展开全部节点，默认 false */
  defaultExpandedAll?: boolean;
  /** 受控的展开节点集合。传入后由父组件控制，组件内 toggle 只读不写 */
  expandedIds?: Set<string>;
  /** 展开状态变化回调（受控模式下父组件必须监听并更新 state） */
  onToggleExpanded?: (next: Set<string>) => void;
}

export function getCategoryPath(catId: string | null, flatCategories: FlatCategory[]): string {
  if (!catId) return "-";
  const parts: string[] = [];
  let current = flatCategories.find((c) => c.id === catId);
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? flatCategories.find((c) => c.id === current!.parent_id) : undefined;
  }
  return parts.join(" - ");
}

/** 构建分类后代映射（含自身），用于递归匹配 */
export function buildDescendantMap(flatCategories: FlatCategory[]): Map<string, Set<string>> {
  const childrenMap = new Map<string, string[]>();
  const allIds = new Set(flatCategories.map((c) => c.id));
  flatCategories.forEach((c) => {
    if (c.parent_id && allIds.has(c.parent_id)) {
      const arr = childrenMap.get(c.parent_id) || [];
      arr.push(c.id);
      childrenMap.set(c.parent_id, arr);
    }
  });
  const cache = new Map<string, Set<string>>();
  function collect(id: string): Set<string> {
    if (cache.has(id)) return cache.get(id)!;
    const result = new Set<string>([id]);
    const children = childrenMap.get(id) || [];
    children.forEach((childId) => {
      collect(childId).forEach((descId) => result.add(descId));
    });
    cache.set(id, result);
    return result;
  }
  flatCategories.forEach((c) => collect(c.id));
  return cache;
}

function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
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
}

function collectAllIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...collectAllIds(node.children));
  }
  return ids;
}

export default function CourseTree({
  tree,
  selectedId,
  onSelect,
  rootLabel,
  placeholder = "搜索...",
  loading = false,
  emptyText = "暂无数据",
  clearFilterText,
  enableDrag = false,
  onReorder,
  renderNodeFooter,
  renderTreeFooter,
  renderActions,
  treeContainerClass = "max-h-[calc(100vh-240px)]",
  showHeader = true,
  showSearch = true,
  defaultExpandedAll = false,
  expandedIds: controlledExpandedIds,
  onToggleExpanded,
}: CourseTreeProps) {
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const dragRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // 受控模式下用 prop，否则用内部 state
  const expandedIds = controlledExpandedIds ?? internalExpandedIds;

  // 挂载时全展开（仅生效一次，避免与用户的折叠操作冲突）
  useEffect(() => {
    if (defaultExpandedAll && tree.length > 0 && controlledExpandedIds === undefined) {
      setInternalExpandedIds(new Set(collectAllIds(tree)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = useCallback((id: string) => {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    if (controlledExpandedIds === undefined) {
      setInternalExpandedIds(next);
    }
    onToggleExpanded?.(next);
  }, [expandedIds, controlledExpandedIds, onToggleExpanded]);

  const filtered = searchText ? filterTree(tree, searchText) : tree;

  // 搜索时自动展开所有匹配节点
  useEffect(() => {
    if (!searchText) return;
    const next = new Set(collectAllIds(filtered));
    if (controlledExpandedIds === undefined) {
      setInternalExpandedIds(next);
    }
    onToggleExpanded?.(next);
  }, [searchText, filtered, controlledExpandedIds, onToggleExpanded]);

  // 拖拽
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    dragRef.current = id;
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragRef.current && dragRef.current !== id) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const dragId = dragRef.current;
    setDragOverId(null);
    dragRef.current = null;
    if (dragId && dragId !== targetId && onReorder) {
      onReorder(dragId, targetId);
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedId === node.id;
    const hasChildren = node.children.length > 0;
    const isDragOver = dragOverId === node.id;

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer rounded text-sm transition-colors ${
            isSelected
              ? "bg-primary/10 text-primary font-medium"
              : "hover:bg-bg-layout"
          } ${isDragOver && enableDrag ? "border-t-2 border-primary" : ""}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => {
            onSelect(node.id);
            // 无论是否有子节点都展开：让外部注入的 renderNodeFooter（如分类下挂章节）
            // 能在「刚被选中」的节点下立即可见，避免叶节点选中后内容仍隐藏。
            if (!expandedIds.has(node.id)) toggleExpand(node.id);
          }}
          draggable={enableDrag}
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
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
          {enableDrag && (
            <span className="shrink-0 text-text-secondary/40 cursor-grab active:cursor-grabbing">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="4" cy="3" r="1.2" />
                <circle cx="8" cy="3" r="1.2" />
                <circle cx="4" cy="6" r="1.2" />
                <circle cx="8" cy="6" r="1.2" />
                <circle cx="4" cy="9" r="1.2" />
                <circle cx="8" cy="9" r="1.2" />
              </svg>
            </span>
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {isExpanded && hasChildren && node.children.map((child) => renderNode(child, depth + 1))}
        {isExpanded && renderNodeFooter?.(node, depth)}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* 全部X 头部 */}
      {showHeader && (
        <div
          onClick={() => onSelect(null)}
          className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium mb-2 ${
            selectedId === null ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-bg-layout"
          }`}
        >
          {rootLabel}
        </div>
      )}

      {/* 搜索框 */}
      {showSearch && (
        <div className="relative mb-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder={placeholder}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
          />
        </div>
      )}

      {/* 树容器 */}
      <div className={`bg-bg-base rounded-lg border border-border overflow-y-auto shrink-0 ${treeContainerClass}`}>
        {loading ? (
          <p className="p-4 text-sm text-text-secondary">加载中...</p>
        ) : filtered.length === 0 && !renderTreeFooter ? (
          <div className="p-4 text-center text-sm text-text-secondary">{emptyText}</div>
        ) : (
          <div className="py-1">
            {filtered.map((node) => renderNode(node, 0))}
            {renderTreeFooter?.()}
          </div>
        )}
      </div>

      {/* 清除筛选 */}
      {clearFilterText && selectedId !== null && (
        <button
          onClick={() => onSelect(null)}
          className="mt-2 w-full text-xs text-text-secondary hover:text-primary"
        >
          {clearFilterText}
        </button>
      )}

      {/* 操作按钮 */}
      {renderActions?.(selectedId)}
    </div>
  );
}