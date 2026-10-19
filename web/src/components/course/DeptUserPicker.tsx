/** 课程分配选择器 · 全公司名册版（用户反馈 v2：与用户管理的全公司部门树同源）
 *
 * 数据源为 /org/members 融合名册（HR 快照 + 账号标注），左组织树右成员列表：
 * - 勾选组织节点 = 连带子树内全部「有账号」成员（纯 user_ids，不产生部门分配行）
 * - 无账号成员灰显不可勾（需先在用户管理开通账号）
 * - 勾选态按子树聚合：全选对勾 / 半选 indeterminate / 未选
 * 浏览态（搜索/展开/聚焦节点）组件内部管理；选择态完全受控。
 */
import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { OrgMemberRow } from "../../lib/api";
import {
  buildCompanyTree, inSubtree, findKeyPath, COMPANY_KEY, UNASSIGNED_KEY,
  type OrgTreeNode,
} from "../../lib/orgTree";

interface DeptUserPickerProps {
  members: OrgMemberRow[];
  /** 已选平台账号 user_id 集合 */
  selectedUsers: Set<string>;
  onChange: (users: Set<string>) => void;
  /** 两栏列表容器的高度类名（编辑页 Tab 空间大可高些，弹窗内紧凑些） */
  listClass?: string;
  /** 是否显示底部已选汇总 chips，默认 true */
  showSummary?: boolean;
}

/** 名册行 → 平台账号 id（无账号返回 null） */
function uidOf(m: OrgMemberRow): string | null {
  return m.account?.user_id ?? m.user_id ?? null;
}

/** 右栏单次最多渲染行数（防止「全公司」视图渲染数千行卡顿） */
const LIST_CAP = 200;

export default function DeptUserPicker({
  members,
  selectedUsers,
  onChange,
  listClass = "max-h-72",
  showSummary = true,
}: DeptUserPickerProps) {
  const [deptSearch, setDeptSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [includeSub, setIncludeSub] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set([COMPANY_KEY]));

  const tree = useMemo(() => buildCompanyTree(members), [members]);

  /** 每个组织节点子树内的「有账号」成员 id（仅随 members 变化，勾选时 O(子树人数) 应用） */
  const subtreeUids = useMemo(() => {
    const map = new Map<string, string[]>();
    const push = (key: string, uid: string) => {
      const arr = map.get(key);
      if (arr) arr.push(uid); else map.set(key, [uid]);
    };
    for (const m of members) {
      const uid = uidOf(m);
      if (!uid) continue;
      push(COMPANY_KEY, uid);
      const path = (m.dept_path || "").split(">").map(s => s.trim()).filter(Boolean).join(">");
      if (!path) continue;
      let acc = "";
      for (const seg of path.split(">")) {
        acc = acc ? `${acc}>${seg}` : seg;
        push(acc, uid);
      }
    }
    return map;
  }, [members]);

  /** userId → 成员行（chips 摘要与右栏姓名回查用） */
  const rowById = useMemo(() => {
    const map = new Map<string, OrgMemberRow>();
    for (const m of members) {
      const uid = uidOf(m);
      if (uid) map.set(uid, m);
    }
    return map;
  }, [members]);

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const focusNode = (key: string) => {
    setActiveKey(key);
    // 选中节点时自动展开祖先链
    setExpandedKeys(prev => {
      const next = new Set(prev);
      findKeyPath(tree, key).forEach(n => next.add(n.key));
      return next;
    });
  };

  const toggleSubtree = (key: string, checking: boolean) => {
    const ids = subtreeUids.get(key) || [];
    const next = new Set(selectedUsers);
    if (checking) ids.forEach(id => next.add(id));
    else ids.forEach(id => next.delete(id));
    onChange(next);
  };

  const toggleUser = (id: string) => {
    const next = new Set(selectedUsers);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  // ── 左树（搜索时按名称剪枝并自动展平命中节点） ──
  const prune = (node: OrgTreeNode): OrgTreeNode | null => {
    if (!deptSearch) return node;
    const hit = node.label.toLowerCase().includes(deptSearch.toLowerCase());
    const kids = node.children.map(prune).filter(Boolean) as OrgTreeNode[];
    if (hit || kids.length > 0) return { ...node, children: kids };
    return null;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownTree = useMemo(() => (deptSearch ? prune(tree) : tree), [tree, deptSearch]);

  const renderNode = (node: OrgTreeNode, depth: number): React.ReactNode => {
    const uids = subtreeUids.get(node.key) || [];
    const checkedCount = uids.reduce((n, id) => n + (selectedUsers.has(id) ? 1 : 0), 0);
    const all = uids.length > 0 && checkedCount === uids.length;
    const partial = checkedCount > 0 && !all;
    const hasChildren = node.children.length > 0;
    const isExpanded = deptSearch ? true : expandedKeys.has(node.key);
    const isActive = activeKey === node.key;
    return (
      <div key={node.key}>
        <div
          className={`flex items-center gap-1.5 py-0.5 px-1 rounded text-xs ${isActive ? "bg-primary/10" : "hover:bg-bg-layout"}`}
          style={{ paddingLeft: `${4 + depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => (deptSearch ? focusNode(node.key) : toggleExpand(node.key))}
              className="text-text-secondary shrink-0"
            >
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          ) : (
            <span className="w-2.5 shrink-0" />
          )}
          <input
            type="checkbox"
            checked={all}
            ref={el => { if (el) el.indeterminate = partial; }}
            disabled={uids.length === 0}
            onChange={() => toggleSubtree(node.key, !all)}
            className="shrink-0"
          />
          <span className="truncate flex-1 cursor-pointer" onClick={() => focusNode(node.key)}>
            {node.label}
          </span>
          <span className={`text-text-secondary/60 shrink-0 ${checkedCount > 0 ? "text-primary" : ""}`}>{node.total}</span>
        </div>
        {isExpanded && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  // ── 右栏（当前聚焦节点子树/直属成员，搜索优先姓名） ──
  const listRows = useMemo(() => {
    const key = activeKey ?? COMPANY_KEY;
    const base = members.filter(m => (includeSub ? inSubtree(m, key) : key === COMPANY_KEY || normEq(m, key)));
    const kw = userSearch.trim();
    return kw ? base.filter(m => m.name.includes(kw) || (m.emp_id || "").includes(kw)) : base;
  }, [members, activeKey, includeSub, userSearch]);
  const listTruncated = listRows.length > LIST_CAP;
  const visibleRows = listTruncated ? listRows.slice(0, LIST_CAP) : listRows;
  const selectableVisible = visibleRows.filter(m => uidOf(m));
  const allVisibleChecked = selectableVisible.length > 0 && selectableVisible.every(m => selectedUsers.has(uidOf(m)!));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {/* 左：全公司组织树 */}
        <div className="border border-border rounded-md p-2">
          <input
            type="text" placeholder="搜索部门..." value={deptSearch}
            onChange={e => setDeptSearch(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1 text-xs mb-1.5"
          />
          <div className={`${listClass} overflow-y-auto space-y-0.5`}>
            {shownTree ? renderNode(shownTree, 0) : (
              <p className="text-xs text-text-secondary py-4 text-center">无匹配部门</p>
            )}
          </div>
        </div>
        {/* 右：成员列表 */}
        <div className="border border-border rounded-md p-2 flex flex-col">
          <div className="flex items-center gap-2 mb-1.5">
            <input
              type="text" placeholder="搜索姓名/工号..." value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              className="flex-1 min-w-0 border border-border rounded-md px-2 py-1 text-xs"
            />
            <label className="flex items-center gap-1 text-xs text-text-secondary shrink-0 cursor-pointer select-none">
              <input type="checkbox" checked={includeSub} onChange={() => setIncludeSub(v => !v)} />
              含下级
            </label>
          </div>
          <div className={`${listClass} overflow-y-auto space-y-0.5`}>
            <label className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-bg-layout rounded text-xs cursor-pointer border-b border-border mb-0.5">
              <input
                type="checkbox" checked={allVisibleChecked}
                onChange={() => {
                  const next = new Set(selectedUsers);
                  selectableVisible.forEach(m => {
                    const uid = uidOf(m)!;
                    if (allVisibleChecked) next.delete(uid); else next.add(uid);
                  });
                  onChange(next);
                }}
              />
              <span className="text-text-secondary">
                全选{activeKey && activeKey !== COMPANY_KEY ? `（${findKeyPath(tree, activeKey).slice(-1)[0]?.label}）` : "（全公司）"}
              </span>
            </label>
            {visibleRows.length === 0 ? (
              <p className="text-xs text-text-secondary py-2 text-center">无匹配人员</p>
            ) : visibleRows.map(m => {
              const uid = uidOf(m);
              return (
                <label
                  key={uid || `${m.emp_id}-${m.name}`}
                  className={`flex items-center gap-1.5 py-0.5 px-1 rounded text-xs ${uid ? "hover:bg-bg-layout cursor-pointer" : "opacity-50"}`}
                >
                  <input type="checkbox" disabled={!uid} checked={uid ? selectedUsers.has(uid) : false}
                    onChange={() => uid && toggleUser(uid)} />
                  <span className="truncate">{m.name}</span>
                  {m.emp_id && <span className="text-text-secondary/60 shrink-0">{m.emp_id}</span>}
                  {m.position && <span className="text-text-secondary truncate hidden md:inline">{m.position}</span>}
                  {!uid && <span className="text-text-secondary/60 shrink-0">无账号</span>}
                </label>
              );
            })}
            {listTruncated && (
              <p className="text-xs text-text-secondary/70 py-2 text-center">
                共 {listRows.length}+ 人，仅显示前 {LIST_CAP} 条——请选择更小部门或用姓名/工号搜索
              </p>
            )}
          </div>
        </div>
      </div>
      {showSummary && selectedUsers.size > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-xs text-text-secondary shrink-0 py-0.5">已选 {selectedUsers.size} 人：</span>
          {[...selectedUsers].slice(0, 60).map(id => (
            <span key={id} className="inline-flex items-center px-2 py-0.5 bg-bg-layout rounded text-xs">
              {rowById.get(id)?.name || id}
            </span>
          ))}
          {selectedUsers.size > 60 && (
            <span className="text-xs text-text-secondary/70 py-0.5">…等 {selectedUsers.size} 人</span>
          )}
        </div>
      )}
    </div>
  );
}

/** 直属判断（与 orgTree.isDirectOf 同口径，独立小函数避免额外 import 环） */
function normEq(m: OrgMemberRow, key: string): boolean {
  const path = (m.dept_path || "")
    .split(">")
    .map(s => s.trim())
    .filter(Boolean)
    .join(">");
  return key === UNASSIGNED_KEY ? !path : path === key;
}
