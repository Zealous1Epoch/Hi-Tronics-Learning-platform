import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import type { UserInfo } from "../../lib/api";
import { ChevronRight, ChevronDown, Plus, Search, Pencil, Trash2 } from "lucide-react";

interface DeptNode {
  id: string; name: string; parent_id: string | null;
  children: DeptNode[];
}
interface FlatDept {
  id: string; name: string; parent_id: string | null;
}

export default function DepartmentUserManage() {
  // 部门树
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [flatDepts, setFlatDepts] = useState<FlatDept[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [loadingTree, setLoadingTree] = useState(true);

  // 树编辑
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const [addingChildUnder, setAddingChildUnder] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState("");

  // 用户列表
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  // 新增用户弹窗
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", employee_id: "", role: "student" });
  const [creatingUser, setCreatingUser] = useState(false);

  const fetchTree = async () => {
    const [treeData, flatData] = await Promise.all([
      api<DeptNode[]>("/departments"),
      api<FlatDept[]>("/departments/flat"),
    ]);
    setTree(treeData);
    setFlatDepts(flatData);
    setLoadingTree(false);
  };

  useEffect(() => { fetchTree(); }, []);

  const fetchUsers = async () => {
    if (!selectedId) return;
    setLoadingUsers(true);
    const params = new URLSearchParams();
    if (userSearch) params.set("search", userSearch);
    const data = await api<UserInfo[]>(`/departments/${selectedId}/users?${params}`);
    setUsers(data);
    setLoadingUsers(false);
  };

  useEffect(() => { fetchUsers(); }, [selectedId]);

  // 树操作
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelect = (nodeId: string) => {
    setSelectedId(nodeId);
    setUserSearch("");
    setRenamingId(null);
  };

  const handleRename = async (deptId: string) => {
    if (!renamingName.trim()) { setRenamingId(null); return; }
    await api(`/departments/${deptId}`, {
      method: "PUT",
      body: JSON.stringify({ name: renamingName.trim() }),
    });
    setRenamingId(null);
    setRenamingName("");
    fetchTree();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此部门将同时删除其子部门，确定？")) return;
    await api(`/departments/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    fetchTree();
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
  };

  const startAddChild = () => {
    if (!selectedId) return;
    setNewChildName("");
    setAddingChildUnder(selectedId);
    setExpandedIds(prev => new Set(prev).add(selectedId));
  };

  // 用户操作
  const handleRoleChange = async (userId: string, role: string) => {
    await api(`/users/${userId}/role`, { method: "PUT", body: JSON.stringify({ role }) });
    fetchUsers();
  };

  const handleStatusChange = async (userId: string, status: string) => {
    await api(`/users/${userId}/status`, { method: "PUT", body: JSON.stringify({ status }) });
    fetchUsers();
  };

  const handleCreateUser = async () => {
    if (!newUser.name.trim() || !newUser.username.trim() || !newUser.password.trim()) return;
    setCreatingUser(true);
    const deptName = selectedId ? flatDepts.find(d => d.id === selectedId)?.name || null : null;
    await api("/users", {
      method: "POST",
      body: JSON.stringify({ ...newUser, department: deptName }),
    });
    setCreatingUser(false);
    setShowCreateUser(false);
    setNewUser({ name: "", username: "", password: "", employee_id: "", role: "student" });
    fetchUsers();
  };

  // 搜索过滤树
  const filterTree = (nodes: DeptNode[], term: string): DeptNode[] => {
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
  };

  const filteredTree = searchText ? filterTree(tree, searchText) : tree;

  useEffect(() => {
    if (!searchText) return;
    const collectIds = (nodes: DeptNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };
    setExpandedIds(new Set(collectIds(filteredTree)));
  }, [searchText]);

  const getDeptPath = (deptId: string | null): string => {
    if (!deptId) return "-";
    const parts: string[] = [];
    let current = flatDepts.find(d => d.id === deptId);
    while (current) {
      parts.unshift(current.name);
      current = current.parent_id ? flatDepts.find(d => d.id === current!.parent_id) : undefined;
    }
    return parts.join(" > ");
  };

  const renderTree = (nodes: DeptNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      const hasChildren = node.children.length > 0;
      const isAddingChild = addingChildUnder === node.id;
      const isRenaming = renamingId === node.id;

      return (
        <div key={node.id}>
          {isRenaming ? (
            <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${8 + depth * 16}px` }}>
              <span className="w-5 shrink-0" />
              <input
                type="text"
                value={renamingName}
                onChange={e => setRenamingName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleRename(node.id);
                  if (e.key === "Escape") { setRenamingId(null); setRenamingName(""); }
                }}
                onBlur={() => {
                  if (!renamingName.trim()) { setRenamingId(null); setRenamingName(""); }
                }}
                className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                autoFocus
              />
            </div>
          ) : (
            <div
              className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
                isSelected ? "bg-primary/10 text-primary font-medium" : ""
              }`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              onClick={() => {
                handleSelect(node.id);
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
          )}
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
          {isAddingChild && (
            <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}>
              <span className="w-5 shrink-0" />
              <input
                type="text"
                value={newChildName}
                onChange={e => setNewChildName(e.target.value)}
                onKeyDown={e => {
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

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4 pb-3 border-b border-border">用户管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧部门树 */}
        <div className="w-56 shrink-0 pr-4 border-r border-border">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text" placeholder="搜索部门..."
              value={searchText} onChange={e => setSearchText(e.target.value)}
              className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
            />
          </div>
          <div className="bg-bg-base rounded-lg border border-border max-h-[calc(100vh-240px)] overflow-y-auto">
            {loadingTree ? (
              <p className="p-4 text-sm text-text-secondary">加载中...</p>
            ) : filteredTree.length === 0 && !addingRoot ? (
              <div className="p-4 text-center text-sm text-text-secondary">
                {searchText ? "无匹配结果" : "暂无部门，点击下方按钮添加"}
              </div>
            ) : (
              <div className="py-1">
                {filteredTree.length > 0 && renderTree(filteredTree)}
                {addingRoot && (
                  <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: 8 }}>
                    <span className="w-5 shrink-0" />
                    <input
                      type="text"
                      value={newRootName}
                      onChange={e => setNewRootName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleAddRoot();
                        if (e.key === "Escape") { setAddingRoot(false); setNewRootName(""); }
                      }}
                      onBlur={() => {
                        if (!newRootName.trim()) { setAddingRoot(false); setNewRootName(""); }
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
            <Plus size={12} /> 添加部门
          </button>
          {selectedId && (
            <div className="mt-1.5 space-y-1.5">
              <button
                onClick={startAddChild}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary-light border border-primary"
              >
                <Plus size={12} /> 添加车间
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    const node = flatDepts.find(d => d.id === selectedId);
                    setRenamingId(selectedId);
                    setRenamingName(node?.name || "");
                  }}
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

        {/* 右侧用户列表 */}
        <div className="flex-1 min-w-0">
          {!selectedId ? (
            <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
              请在左侧选择一个部门
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-text-secondary">
                  {getDeptPath(selectedId)}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="搜索姓名/工号..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && fetchUsers()}
                    className="border border-border rounded-md px-3 py-1.5 text-sm w-48"
                  />
                  <button
                    onClick={fetchUsers}
                    className="px-3 py-1.5 text-xs bg-primary text-white rounded-md border border-primary"
                  >
                    搜索
                  </button>
                  <button
                    onClick={() => setShowCreateUser(true)}
                    className="px-3 py-1.5 text-xs bg-primary text-white rounded-md border border-primary"
                  >
                    <Plus size={14} className="inline mr-1" />新增用户
                  </button>
                </div>
              </div>

              <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm table-fixed">
                  <thead className="bg-bg-layout border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">姓名</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">工号</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">部门</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">角色</th>
                      <th className="text-left px-4 py-3 font-medium text-text-secondary">状态</th>
                      <th className="text-right px-4 py-3 font-medium text-text-secondary">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingUsers ? (
                      <tr><td colSpan={6} className="text-center py-8 text-text-secondary">加载中...</td></tr>
                    ) : users.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-text-secondary">该部门暂无用户</td></tr>
                    ) : (
                      users.map(u => (
                        <tr key={u.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                          <td className="px-4 py-3 font-medium">{u.name}</td>
                          <td className="px-4 py-3 text-text-secondary">{u.employee_id || "-"}</td>
                          <td className="px-4 py-3 text-text-secondary">{u.department || "-"}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                              u.role === "admin" ? "bg-primary/10 text-primary" : "bg-border text-text-secondary"
                            }`}>
                              {u.role === "admin" ? "管理员" : "学员"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                              u.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                            }`}>
                              {u.status === "active" ? "正常" : "已禁用"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => handleRoleChange(u.id, u.role === "admin" ? "student" : "admin")}
                                className="text-xs text-primary hover:underline"
                              >
                                {u.role === "admin" ? "降为学员" : "提升管理员"}
                              </button>
                              <button
                                onClick={() => handleStatusChange(u.id, u.status === "active" ? "disabled" : "active")}
                                className={`text-xs hover:underline ${
                                  u.status === "active" ? "text-red-500" : "text-emerald-600"
                                }`}
                              >
                                {u.status === "active" ? "禁用" : "启用"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    {/* 新增用户弹窗 */}
      {showCreateUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreateUser(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-bold text-sm">新增用户</h3>
              <button onClick={() => setShowCreateUser(false)} className="text-text-secondary hover:text-text-base">
                <span className="text-lg">&times;</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">姓名 *</label>
                <input
                  type="text" value={newUser.name}
                  onChange={e => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="输入姓名"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">用户名 *</label>
                <input
                  type="text" value={newUser.username}
                  onChange={e => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="输入用户名"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">密码 *</label>
                <input
                  type="password" value={newUser.password}
                  onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="输入密码"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">工号</label>
                <input
                  type="text" value={newUser.employee_id}
                  onChange={e => setNewUser(prev => ({ ...prev, employee_id: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="输入工号"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">部门</label>
                <input
                  type="text"
                  value={selectedId ? flatDepts.find(d => d.id === selectedId)?.name || "" : ""}
                  disabled
                  className="w-full border border-border rounded-md px-3 py-2 text-sm bg-bg-layout text-text-secondary"
                  placeholder="自动使用当前选中部门"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">角色</label>
                <select
                  value={newUser.role}
                  onChange={e => setNewUser(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="student">学员</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={handleCreateUser}
                disabled={creatingUser}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light border border-primary disabled:opacity-50"
              >
                {creatingUser ? "创建中..." : "创建"}
              </button>
              <button
                onClick={() => setShowCreateUser(false)}
                className="px-4 py-2 rounded-md text-sm border border-border text-text-secondary hover:text-text-base"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}