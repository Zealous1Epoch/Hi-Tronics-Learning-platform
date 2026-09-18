import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import type { UserInfo } from "../../lib/api";

interface UserListResponse extends Array<UserInfo> {}

export default function UserManage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    const data = await api<UserListResponse>(`/users?${params}`);
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await api(`/users/${userId}/role`, { method: "PUT", body: JSON.stringify({ role }) });
      setErrorMsg("");
      fetchUsers();
    } catch (e: any) {
      setErrorMsg(e.message || "操作失败");
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    try {
      await api(`/users/${userId}/status`, { method: "PUT", body: JSON.stringify({ status }) });
      setErrorMsg("");
      fetchUsers();
    } catch (e: any) {
      setErrorMsg(e.message || "操作失败");
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">用户管理</h2>
      {errorMsg && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-2 text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="text-red-400 hover:text-red-600 ml-2">&times;</button>
        </div>
      )}
      <div className="bg-bg-base rounded-lg border border-border">
        <div className="p-4 border-b border-border/60 flex gap-3">
          <input
            type="text"
            placeholder="搜索姓名/用户名/工号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchUsers()}
            className="border border-border/60 rounded-md px-3 py-1.5 text-sm w-64 bg-bg-base"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="border border-border/60 rounded-md px-3 py-1.5 text-sm bg-bg-base"
          >
            <option value="">全部角色</option>
            <option value="admin">管理员</option>
            <option value="student">学员</option>
          </select>
          <button
            onClick={fetchUsers}
            className="bg-primary text-white px-4 py-1.5 rounded-md text-sm"
          >
            搜索
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border/40">
            <tr>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">姓名</th>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">用户名</th>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">工号</th>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">部门</th>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">角色</th>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">状态</th>
              <th className="text-left px-4 py-2.5 text-text-secondary/70 font-normal text-xs">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 text-text-secondary">加载中...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-text-secondary">暂无用户</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border/40 hover:bg-bg-layout">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.username.replace(/^wx_/i, '')}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.employee_id || "-"}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.department || "-"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                      u.role === "admin" ? "bg-primary/10 text-primary" : "bg-border text-text-secondary"
                    }`}>
                      {u.role === "admin" ? "管理员" : "学员"}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                      u.status === "active" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                    }`}>
                      {u.status === "active" ? "正常" : "已禁用"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleRoleChange(u.id, u.role === "admin" ? "student" : "admin")}
                        className="text-xs text-text-secondary hover:text-primary transition-colors"
                      >
                        {u.role === "admin" ? "降为学员" : "提升管理员"}
                      </button>
                      <button
                        onClick={() => handleStatusChange(u.id, u.status === "active" ? "disabled" : "active")}
                        className={`text-xs transition-colors ${
                          u.status === "active" ? "text-text-secondary/60 hover:text-red-500" : "text-text-secondary/60 hover:text-green-600"
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
    </div>
  );
}