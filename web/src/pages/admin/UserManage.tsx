import { useState, useEffect } from "react";
import { Search } from "lucide-react";
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
      <h2 className="k-title text-[22px] text-primary mb-4">用户管理</h2>
      {errorMsg && (
        <div className="mb-3 bg-danger/10 border border-danger/40 text-danger rounded-md px-4 py-2 text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="text-danger/60 hover:text-danger ml-2">&times;</button>
        </div>
      )}
      <div className="k-filter-bar mb-4">
        <div className="k-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索姓名/用户名/工号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchUsers()}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="k-ctl w-32"
        >
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="student">学员</option>
        </select>
        <span className="k-spacer" />
        <button
          onClick={fetchUsers}
          className="k-btn k-btn-primary k-btn-sm"
        >
          搜索
        </button>
      </div>
      <div className="k-table-wrap">
        <table className="k-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>用户名</th>
              <th>工号</th>
              <th>部门</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="k-empty">加载中...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="k-empty">暂无用户</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="k-muted">{u.username.replace(/^wx_/i, '')}</td>
                  <td className="k-muted">{u.employee_id || "-"}</td>
                  <td className="k-muted">{u.department || "-"}</td>
                  <td className="whitespace-nowrap">
                    <span className={`k-tag ${u.role === "admin" ? "k-tag-primary" : ""}`}>
                      {u.role === "admin" ? "管理员" : "学员"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={`k-tag ${u.status === "active" ? "k-tag-success" : "k-tag-danger"}`}>
                      {u.status === "active" ? "正常" : "已禁用"}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleRoleChange(u.id, u.role === "admin" ? "student" : "admin")}
                        className="k-link"
                      >
                        {u.role === "admin" ? "降为学员" : "提升管理员"}
                      </button>
                      <button
                        onClick={() => handleStatusChange(u.id, u.status === "active" ? "disabled" : "active")}
                        className={u.status === "active" ? "k-link k-link-danger" : "k-link"}
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