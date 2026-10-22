import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Search, Building2 } from "lucide-react";
import type { OrgTreeNode } from "../lib/orgTree";
import { COMPANY_KEY, findKeyPath } from "../lib/orgTree";

interface OrgDeptTreeProps {
  tree: OrgTreeNode; // 「全公司」根节点（数据由父组件派生传入，本组件不发请求）
  selectedKey: string; // 始终有值：COMPANY_KEY 或部门路径 key
  onSelect: (key: string) => void;
}

/**
 * 全员名册部门树（只读）：
 * - 顶行「全公司」根 + 递归部门节点，节点右侧显示子树累计人数徽标
 * - 展开态与选中态分离：点箭头只展开/折叠，点名字只选中
 * - 选中部门时自动展开其祖先链
 * - 树内搜索：命中节点保留祖先路径并自动展开
 */
export default function OrgDeptTree({ tree, selectedKey, onSelect }: OrgDeptTreeProps) {
  // 默认展开「全公司」根节点：进页面即可看到所有一级部门
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([COMPANY_KEY]));
  const [searchText, setSearchText] = useState("");

  // 选中变化时补齐祖先展开（收起态的深层部门被选中后仍可见）
  useEffect(() => {
    if (selectedKey === COMPANY_KEY) return;
    setExpanded(prev => {
      const chain = findKeyPath(tree, selectedKey).map(n => n.key).filter(k => k !== selectedKey);
      if (chain.every(k => prev.has(k))) return prev;
      const next = new Set(prev);
      chain.forEach(k => next.add(k));
      return next;
    });
  }, [selectedKey, tree]);

  // 搜索过滤：保留命中节点及其祖先
  const filteredTree = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    if (!term) return tree;
    const filter = (node: OrgTreeNode): OrgTreeNode | null => {
      const selfHit = node.label.toLowerCase().includes(term);
      const kids = node.children.map(filter).filter((c): c is OrgTreeNode => c !== null);
      if (selfHit || kids.length > 0) return { ...node, children: selfHit ? node.children : kids };
      return null;
    };
    const hit = filter(tree);
    return hit ?? tree; // 全不命中时显示空树而非整棵原树
  }, [tree, searchText]);

  // 搜索时自动展开全部命中节点
  useEffect(() => {
    if (!searchText.trim()) return;
    const collect = (node: OrgTreeNode, acc: string[]) => {
      if (node.children.length) acc.push(node.key);
      node.children.forEach(c => collect(c, acc));
    };
    const keys: string[] = [];
    collect(filteredTree, keys);
    setExpanded(new Set(keys));
  }, [searchText, filteredTree]);

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const renderNode = (node: OrgTreeNode, depth: number) => {
    const isCompany = node.kind === "company";
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.key);
    const isSelected = selectedKey === node.key;
    return (
      <div key={node.key}>
        <div
          className={`k-tree-item ${isSelected ? "is-active" : ""} ${node.kind === "unassigned" ? "italic" : ""}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => onSelect(node.key)}
        >
          {hasChildren ? (
            <button
              onClick={e => {
                e.stopPropagation();
                toggle(node.key);
              }}
              className="p-0.5 shrink-0 text-text-secondary"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          {isCompany && <Building2 size={14} className="shrink-0" />}
          <span className="truncate">{node.label}</span>
          <span className="k-tree-count shrink-0 min-w-[2rem] text-right tabular-nums">
            {node.total}
          </span>
        </div>
        {isExpanded && hasChildren && node.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="k-search mb-2 shrink-0">
        <Search size={14} />
        <input
          type="text"
          placeholder="搜索部门..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
      </div>
      <div className="k-card flex-1 min-h-0 overflow-y-auto py-1">
        {filteredTree.children.length === 0 && searchText.trim() ? (
          <p className="k-empty">无匹配部门</p>
        ) : (
          renderNode(filteredTree, 0)
        )}
      </div>
    </div>
  );
}
