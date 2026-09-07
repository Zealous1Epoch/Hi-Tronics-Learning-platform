import { useState, useEffect, useMemo } from "react";
import { api, BASE } from "../../lib/api";
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

  // 编辑用户
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", username: "", employee_id: "", department: "", role: "student", password: "" });

  // 批量导入
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success_count: number; skip_count: number; total: number; errors: string[] } | null>(null);

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
    setLoadingUsers(true);
    const params = new URLSearchParams();
    if (userSearch) params.set("search", userSearch);
    if (selectedId) {
      const data = await api<UserInfo[]>(`/departments/${selectedId}/users?${params}`);
      setUsers(data);
    } else {
      const data = await api<UserInfo[]>(`/users?${params}`);
      setUsers(data);
    }
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

  const handleEditUser = async () => {
    if (!editForm.name.trim() || !editForm.username.trim() || !editingUserId) return;
    await api(`/users/${editingUserId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: editForm.name.trim(),
        username: editForm.username.trim(),
        employee_id: editForm.employee_id.trim() || null,
        department: editForm.department.trim() || null,
        role: editForm.role,
        password: editForm.password || null,
      }),
    });
    setShowEditUser(false);
    setEditingUserId(null);
    fetchUsers();
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", importFile);
    const url = `/api/users/batch-import${selectedId ? `?department_id=${selectedId}` : ""}`;
    const token = localStorage.getItem("lp_token");
    const res = await fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || "导入失败");
    setImportResult(result);
    setImporting(false);
    setImportFile(null);
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

  const filteredTree = useMemo(
    () => (searchText ? filterTree(tree, searchText) : tree),
    [tree, searchText]
  );

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
          <div
            onClick={() => { setSelectedId(null); setUsers([]); }}
            className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium mb-2 ${
              selectedId === null ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-bg-layout"
            }`}
          >
            全部用户
          </div>
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
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">
              {selectedId ? getDeptPath(selectedId) : "全部用户"}
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
                  <button
                    onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); }}
                    className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-bg-layout"
                  >
                    批量导入
                  </button>
                </div>
              </div>

              <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm table-fixed">
                  <thead className="bg-bg-layout border-b border-border">
                    <tr>
                      <th className="text-center px-4 py-3 font-medium text-text-secondary">姓名</th>
                      <th className="text-center px-3 py-3 font-medium text-text-secondary">工号</th>
                      <th className="text-center px-3 py-3 font-medium text-text-secondary">部门</th>
                      <th className="text-center px-3 py-3 font-medium text-text-secondary w-20">角色</th>
                      <th className="text-center px-3 py-3 font-medium text-text-secondary w-20">状态</th>
                      <th className="text-center px-3 py-3 font-medium text-text-secondary w-64">操作</th>
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
                          <td className="px-4 py-3 font-medium text-center">{u.name}</td>
                          <td className="px-3 py-3 text-text-secondary text-center">{u.employee_id || "-"}</td>
                          <td className="px-3 py-3 text-text-secondary text-center">{u.department || "-"}</td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                              u.role === "admin" ? "bg-primary/10 text-primary" : "bg-border text-text-secondary"
                            }`}>
                              {u.role === "admin" ? "管理员" : "学员"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                              u.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                            }`}>
                              {u.status === "active" ? "正常" : "已禁用"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => handleRoleChange(u.id, u.role === "admin" ? "student" : "admin")}
                              className="text-xs text-primary border border-primary rounded px-1.5 py-0.5 hover:bg-primary/5 mr-1"
                            >
                              {u.role === "admin" ? "降为学员" : "提升管理员"}
                            </button>
                            <button
                              onClick={() => handleStatusChange(u.id, u.status === "active" ? "disabled" : "active")}
                              className={`text-xs border rounded px-1.5 py-0.5 hover:bg-red-50 mr-1 ${
                                u.status === "active" ? "text-red-500 border-red-200" : "text-emerald-600 border-emerald-200"
                              }`}
                            >
                              {u.status === "active" ? "禁用" : "启用"}
                            </button>
                            <button
                              onClick={() => {
                                setEditingUserId(u.id);
                                setEditForm({
                                  name: u.name,
                                  username: u.username,
                                  employee_id: u.employee_id || "",
                                  department: u.department || "",
                                  role: u.role,
                                  password: "",
                                });
                                setShowEditUser(true);
                              }}
                              className="text-xs text-primary border border-primary rounded px-1.5 py-0.5 hover:bg-primary/5 mr-1"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => {
                                if (!confirm(`确定删除用户 ${u.name}？`)) return;
                                api(`/users/${u.id}`, { method: "DELETE" }).then(fetchUsers);
                              }}
                              className="text-xs text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
        </div>
      </div>
    {/* 批量导入弹窗 */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowImport(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-bold text-base">批量导入用户</h3>
              <button onClick={() => setShowImport(false)} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-6">
              {/* 步骤 1: 下载模板 */}
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">下载模板</p>
                  <p className="text-xs text-text-secondary mb-2">按模板格式填写用户信息</p>
                  <button
                    onClick={() => {
                      const token = localStorage.getItem("lp_token");
                      fetch(`${BASE}/users/batch-import/template`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      })
                        .then(res => {
                          if (!res.ok) throw new Error("下载失败");
                          return res.blob();
                        })
                        .then(blob => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "user_import_template.xlsx";
                          a.click();
                          URL.revokeObjectURL(url);
                        })
                        .catch(err => alert(err.message));
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-md px-3 py-1.5 hover:bg-primary/5 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    下载导入模板
                  </button>
                  {selectedId && (
                    <p className="text-xs text-text-secondary mt-2">
                      导入用户将自动归属到：<span className="text-primary font-medium">{flatDepts.find(d => d.id === selectedId)?.name || ""}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* 步骤 2: 上传文件 */}
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">上传 Excel 文件</p>
                  <label className={`block border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    importFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-text-secondary/30"
                  }`}>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={e => setImportFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    {importFile ? (
                      <div className="flex items-center gap-2 justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        <span className="text-sm font-medium text-text-base">{importFile.name}</span>
                        <button onClick={(e) => { e.stopPropagation(); setImportFile(null); }} className="text-xs text-red-500 hover:underline ml-1">移除</button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span className="text-sm text-text-secondary">点击选择文件或拖拽到此区域</span>
                        <span className="text-xs text-text-secondary">仅支持 .xlsx / .xls 格式</span>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {/* 导入结果 */}
              {importResult && (
                <div className={`rounded-lg border p-4 text-sm ${
                  importResult.errors.length > 0 ? "border-yellow-200 bg-yellow-50" : "border-emerald-200 bg-emerald-50"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={importResult.errors.length > 0 ? "text-yellow-600" : "text-emerald-600"}>
                      {importResult.errors.length > 0
                        ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                        : <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>
                      }
                    </svg>
                    <span className={`font-medium ${importResult.errors.length > 0 ? "text-yellow-800" : "text-emerald-800"}`}>
                      导入完成
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-text-secondary">成功 <span className="text-emerald-600 font-bold">{importResult.success_count}</span> 条</span>
                    <span className="text-text-secondary">跳过 <span className="text-text-secondary font-bold">{importResult.skip_count}</span> 条</span>
                    <span className="text-text-secondary">共 <span className="font-bold">{importResult.total}</span> 条</span>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="mt-2 max-h-28 overflow-y-auto space-y-0.5">
                      {importResult.errors.map((err, i) => (
                        <p key={i} className="text-red-500 text-xs">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-layout/50">
              <button
                onClick={() => setShowImport(false)}
                className="px-4 py-2 rounded-md text-sm border border-border text-text-secondary hover:text-text-base hover:bg-bg-base transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={!importFile || importing}
                className="px-5 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {importing ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg>
                    导入中...
                  </>
                ) : (
                  "开始导入"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 编辑用户弹窗 */}
      {showEditUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setShowEditUser(false); setEditingUserId(null); }}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-bold text-sm">编辑用户</h3>
              <button onClick={() => { setShowEditUser(false); setEditingUserId(null); }} className="text-text-secondary hover:text-text-base">
                <span className="text-lg">&times;</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">姓名 *</label>
                <input
                  type="text" value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">用户名 *</label>
                <input
                  type="text" value={editForm.username}
                  onChange={e => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">新密码（留空不修改）</label>
                <input
                  type="password" value={editForm.password}
                  onChange={e => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="留空则不修改密码"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">工号</label>
                <input
                  type="text" value={editForm.employee_id}
                  onChange={e => setEditForm(prev => ({ ...prev, employee_id: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">部门</label>
                <input
                  type="text" value={editForm.department}
                  onChange={e => setEditForm(prev => ({ ...prev, department: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">角色</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="student">学员</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={handleEditUser}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light border border-primary"
              >
                保存
              </button>
              <button
                onClick={() => { setShowEditUser(false); setEditingUserId(null); }}
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