/** 部门-学员双栏选择器（课程管理重构 S4，从 CourseManage 编辑弹窗/分配弹窗两份重复实现合并）
 *
 * 行为保持与旧实现一致：
 * - 勾选部门 → 自动全选该部门（含子孙部门）成员；取消 → 连带移除
 * - 点击部门名 → 右栏过滤显示该部门成员；右栏支持 全选/搜索
 * - 底部汇总 chips：部门 chip + 未被所选部门覆盖的个人 chip
 * 选择状态完全受控（selectedUsers/selectedDepts + onChange），
 * 搜索词/展开态/聚焦部门等浏览态组件内部管理。
 */
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { DeptNode, UserRow } from "../../lib/courseApi";
import {
  findDeptNode, collectDescendantNames, findDeptByName, matchDept, filterDeptTree,
} from "./deptTreeUtils";

export interface DeptUserSelection {
  users: Set<string>;
  depts: Set<string>;
}

interface DeptUserPickerProps {
  allUsers: UserRow[];
  allDepts: DeptNode[];
  selectedUsers: Set<string>;
  selectedDepts: Set<string>;
  onChange: (next: DeptUserSelection) => void;
  /** 两栏列表容器的高度类名（编辑页 Tab 空间大可高些，弹窗内紧凑些） */
  listClass?: string;
  /** 是否显示底部已选汇总 chips，默认 true */
  showSummary?: boolean;
}

export default function DeptUserPicker({
  allUsers,
  allDepts,
  selectedUsers,
  selectedDepts,
  onChange,
  listClass = "max-h-72",
  showSummary = true,
}: DeptUserPickerProps) {
  const [deptSearch, setDeptSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [expandedDeptIds, setExpandedDeptIds] = useState<Set<string>>(new Set());

  const toggleDeptExpand = (id: string) => {
    setExpandedDeptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** 勾选/取消部门：连带其全部子孙部门成员 */
  const toggleDept = (node: DeptNode, checking: boolean) => {
    const depts = new Set(selectedDepts);
    const users = new Set(selectedUsers);
    const names = collectDescendantNames(node);
    const userIds = allUsers
      .filter(u => names.some(name => matchDept(u.department, name)))
      .map(u => u.id);
    if (checking) {
      depts.add(node.id);
      setActiveDeptId(node.id);
      userIds.forEach(id => users.add(id));
    } else {
      depts.delete(node.id);
      userIds.forEach(id => users.delete(id));
    }
    onChange({ users, depts });
  };

  const toggleUser = (id: string) => {
    const users = new Set(selectedUsers);
    if (users.has(id)) users.delete(id); else users.add(id);
    onChange({ users, depts: selectedDepts });
  };

  const renderDeptNodes = (nodes: DeptNode[], depth: number): React.ReactNode[] =>
    nodes.map(node => {
      const hasChildren = (node.children || []).length > 0;
      const isExpanded = expandedDeptIds.has(node.id);
      const isActive = activeDeptId === node.id;
      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1.5 py-0.5 px-1 rounded text-xs ${isActive ? "bg-primary/10" : "hover:bg-bg-layout"}`}
            style={{ paddingLeft: `${4 + depth * 14}px` }}
          >
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleDeptExpand(node.id); }}
                className="text-text-secondary shrink-0"
              >
                {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            ) : (
              <span className="w-2.5 shrink-0" />
            )}
            <input
              type="checkbox"
              checked={selectedDepts.has(node.id)}
              onChange={() => toggleDept(node, !selectedDepts.has(node.id))}
              className="shrink-0"
            />
            <span
              className="truncate flex-1 cursor-pointer"
              onClick={() => setActiveDeptId(isActive ? null : node.id)}
            >
              {node.name}
            </span>
          </div>
          {isExpanded && hasChildren && renderDeptNodes(node.children!, depth + 1)}
        </div>
      );
    });

  const activeDept = activeDeptId ? findDeptNode(allDepts, activeDeptId) : null;
  const activeDeptNames = activeDept ? collectDescendantNames(activeDept) : [];
  const filteredUsers = allUsers.filter(u => {
    if (activeDeptNames.length > 0 && !activeDeptNames.some(name => matchDept(u.department, name))) return false;
    if (userSearch && !u.name.includes(userSearch) && !(u.department && u.department.includes(userSearch))) return false;
    return true;
  });
  const allChecked = filteredUsers.length > 0 && filteredUsers.every(u => selectedUsers.has(u.id));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {/* 左：部门树 */}
        <div className="border border-border rounded-md p-2">
          <input
            type="text" placeholder="搜索部门..." value={deptSearch}
            onChange={e => setDeptSearch(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1 text-xs mb-1.5"
          />
          <div className={`${listClass} overflow-y-auto space-y-0.5`}>
            {renderDeptNodes(filterDeptTree(allDepts, deptSearch), 0)}
          </div>
        </div>
        {/* 右：学员列表 */}
        <div className="border border-border rounded-md p-2">
          <input
            type="text" placeholder="搜索姓名..." value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1 text-xs mb-1.5"
          />
          <div className={`${listClass} overflow-y-auto space-y-0.5`}>
            {!activeDept ? (
              <p className="text-xs text-text-secondary py-4 text-center">点击左侧部门名称查看学员</p>
            ) : filteredUsers.length === 0 ? (
              <p className="text-xs text-text-secondary py-2 text-center">该部门暂无用户</p>
            ) : (
              <div>
                <label className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-bg-layout rounded text-xs cursor-pointer border-b border-border mb-0.5">
                  <input
                    type="checkbox" checked={allChecked}
                    onChange={() => {
                      const users = new Set(selectedUsers);
                      filteredUsers.forEach(u => {
                        if (allChecked) users.delete(u.id); else users.add(u.id);
                      });
                      onChange({ users, depts: selectedDepts });
                    }}
                  />
                  <span className="text-text-secondary">全选</span>
                </label>
                {filteredUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-bg-layout rounded text-xs cursor-pointer">
                    <input type="checkbox" checked={selectedUsers.has(u.id)} onChange={() => toggleUser(u.id)} />
                    <span className="truncate">{u.name}</span>
                    {u.department && <span className="text-text-secondary truncate">({u.department})</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {showSummary && (selectedDepts.size > 0 || selectedUsers.size > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...selectedDepts].map(id => {
            const d = findDeptNode(allDepts, id);
            return d ? (
              <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">
                {d.name}（部门）
              </span>
            ) : null;
          })}
          {allUsers.filter(u =>
            selectedUsers.has(u.id) &&
            !selectedDepts.has(findDeptByName(allDepts, u.department)?.id || "")
          ).map(u => (
            <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-layout rounded text-xs">{u.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
