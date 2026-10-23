import { useState, useEffect, useMemo } from "react";
import { api, BASE } from "../../lib/api";
import type { OrgMembersResponse, OrgMemberRow, OrgSyncResult, OrgProvisionResult } from "../../lib/api";
import OrgDeptTree from "../../components/OrgDeptTree";
import DeptManageModal from "../../components/DeptManageModal";
import {
  buildCompanyTree,
  inSubtree,
  isDirectOf,
  findKeyPath,
  COMPANY_KEY,
  UNASSIGNED_KEY,
} from "../../lib/orgTree";
import { Plus, RefreshCw, Search, Settings2, UserPlus } from "lucide-react";

const PAGE_SIZE = 50;

// HR 名册导入入口开关：生产构建（web/.env.production）设 false —— 融合视图
// 界面保留但不导入全公司名册（按钮隐藏 + 后端 ORG_SYNC_ENABLED 闸门双保险）。
const SYNC_ENABLED = import.meta.env.VITE_ENABLE_ORG_SYNC !== "false";

type AccFilter = "all" | "has" | "none" | "unlinked";

export default function DepartmentUserManage() {
  // 全员名册（镜像）+ 账号融合数据
  const [org, setOrg] = useState<OrgMembersResponse | null>(null);
  // 平台部门扁平表（/departments/flat）：新增/编辑弹窗的部门下拉数据源。
  // 部门树只由「部门管理」和名册重整维护，用户表单不再手输文本造节点。
  const [flatDepts, setFlatDepts] = useState<{ id: string; name: string; parent_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 同步
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 批量开通账号
  const [provisioning, setProvisioning] = useState(false);

  // 树选中 / 筛选
  const [selectedKey, setSelectedKey] = useState<string>(COMPANY_KEY);
  const [scope, setScope] = useState<"subtree" | "direct">("subtree");
  const [accFilter, setAccFilter] = useState<AccFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showDeptModal, setShowDeptModal] = useState(false);

  // 新增用户弹窗
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", employee_id: "", department: "", role: "student" });
  const [creatingUser, setCreatingUser] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 编辑用户
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", username: "", employee_id: "", department: "", role: "student", password: "" });
  const [editError, setEditError] = useState<string | null>(null);

  // 批量导入
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success_count: number; skip_count: number; total: number; errors: string[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchOrg = async () => {
    try {
      const data = await api<OrgMembersResponse>("/org/members");
      setOrg(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchFlatDepts = async () => {
    try {
      setFlatDepts(await api<{ id: string; name: string; parent_id: string | null }[]>("/departments/flat"));
    } catch {
      /* 下拉数据拉取失败不阻塞页面，弹窗内表现为部门选项为空 */
    }
  };

  useEffect(() => {
    fetchOrg();
    fetchFlatDepts();
  }, []);

  // 部门下拉选项：深度优先排序，label 缩进表层级，value = 完整路径文本
  // （'-' 分隔，提交后端后按已有链精确匹配——选项即合法值，杜绝手输造碎节点）
  const deptOptions = useMemo(() => {
    const byParent = new Map<string | null, typeof flatDepts>();
    for (const d of flatDepts) {
      const key = d.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(d);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    const out: { value: string; label: string }[] = [];
    const walk = (pid: string | null, prefix: string[], depth: number) => {
      for (const d of byParent.get(pid) ?? []) {
        const path = [...prefix, d.name];
        out.push({ value: path.join("-"), label: `${"　".repeat(depth)}${d.name}` });
        walk(d.id, path, depth + 1);
      }
    };
    walk(null, [], 0);
    return out;
  }, [flatDepts]);

  // ── 派生：部门树 / 面包屑 / 行集合 ──
  const tree = useMemo(() => buildCompanyTree(org?.members ?? []), [org]);
  const breadcrumb = useMemo(() => findKeyPath(tree, selectedKey), [tree, selectedKey]);
  const activeNode = breadcrumb[breadcrumb.length - 1];

  useEffect(() => {
    setPage(1);
  }, [selectedKey, scope, accFilter, search]);

  const rows = useMemo(() => {
    if (!org) return [];
    let base: OrgMemberRow[];
    if (accFilter === "unlinked") {
      base = org.unlinked_accounts;
    } else {
      base = org.members.filter(m =>
        selectedKey === COMPANY_KEY || scope === "subtree"
          ? inSubtree(m, selectedKey)
          : isDirectOf(m, selectedKey)
      );
      if (accFilter === "has") base = base.filter(m => m.account);
      if (accFilter === "none") base = base.filter(m => !m.account);
    }
    const term = search.trim().toLowerCase();
    if (term) {
      base = base.filter(
        m =>
          m.name.toLowerCase().includes(term) ||
          (m.emp_id || "").toLowerCase().includes(term) ||
          (m.employee_id || "").toLowerCase().includes(term) ||
          (m.position || "").toLowerCase().includes(term) ||
          (m.dept_path || "").toLowerCase().includes(term) ||
          (m.department || "").toLowerCase().includes(term)
      );
    }
    return base;
  }, [org, selectedKey, scope, accFilter, search]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── 同步 ──
  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api<OrgSyncResult>("/org/sync", { method: "POST" });
      setSyncMsg({ ok: true, text: `同步完成：导入 ${r.imported} 人（原 ${r.previous} 人）` });
      await fetchOrg();
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  };

  // ── 批量开通账号（为「未开通」名册人员建无密码学生账号） ──
  const handleProvision = async () => {
    const pending = org
      ? org.members.filter(m => !m.account && (m.emp_id || "").trim()).length
      : 0;
    if (
      !confirm(
        `将为名册中 ${pending} 名未开通账号的员工批量创建账号。\n\n` +
          `· 用户名 = 工号，角色 = 学员，不设置密码——只能经 OA / 企业微信登录进入，\n` +
          `  密码登录入口对这类账号关闭（防弱密码/代登录风险）\n` +
          `· 已有账号、无工号、用户名被占用的会跳过；操作幂等，可重复执行\n\n` +
          `确定继续？`
      )
    )
      return;
    setProvisioning(true);
    setSyncMsg(null);
    try {
      const r = await api<OrgProvisionResult>("/org/provision", { method: "POST" });
      const parts = [`新建 ${r.created}`, `已有账号 ${r.existing}`];
      if (r.conflict > 0) parts.push(`用户名冲突跳过 ${r.conflict}`);
      if (r.no_employee_id > 0) parts.push(`无工号跳过 ${r.no_employee_id}`);
      setSyncMsg({ ok: true, text: `批量开通完成（名册共 ${r.total} 人）：${parts.join("，")}` });
      await fetchOrg();
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setProvisioning(false);
    }
  };

  // ── 账号操作（操作对象是 account.user_id，成功后重拉融合数据） ──
  const handleRoleChange = async (userId: string, role: string) => {
    await api(`/users/${userId}/role`, { method: "PUT", body: JSON.stringify({ role }) });
    fetchOrg();
  };

  const handleStatusChange = async (userId: string, status: string) => {
    await api(`/users/${userId}/status`, { method: "PUT", body: JSON.stringify({ status }) });
    fetchOrg();
  };

  const handleDelete = async (row: OrgMemberRow) => {
    const acc = row.account;
    if (!acc) return;
    if (!confirm(`确定删除用户 ${acc.name}？`)) return;
    try {
      await api(`/users/${acc.user_id}?confirm=true`, { method: "DELETE" });
      fetchOrg();
    } catch (e: any) {
      const msg = e?.message || "删除失败";
      // 后端检测到学习/考试/签到等历史记录时返回 409，需二次确认才连历史一并删除
      if (msg.includes("学习记录")) {
        if (!confirm(`${msg}\n\n确定要连同这些记录一并删除该用户吗？此操作不可恢复。`)) return;
        try {
          await api(`/users/${acc.user_id}?confirm=true&force=true`, { method: "DELETE" });
          fetchOrg();
        } catch (e2: any) {
          alert(e2?.message || "删除失败");
        }
        return;
      }
      alert(msg);
    }
  };

  // ── 开通账号 / 新增用户 ──
  // 预填部门仅接受「已有部门链」的路径（下拉框合法值），名册路径对不上时留空自选
  const legitDept = (t: string) => (deptOptions.some(o => o.value === t) ? t : "");

  const openCreate = (row?: OrgMemberRow) => {
    const deptFromTree =
      selectedKey === COMPANY_KEY || selectedKey === UNASSIGNED_KEY
        ? ""
        : selectedKey.replaceAll(">", "-");
    setCreateError(null);
    setNewUser({
      name: row?.name ?? "",
      username: row?.emp_id ?? "",
      password: "",
      employee_id: row?.emp_id ?? "",
      department: legitDept(row ? (row.dept_path || "").replaceAll(">", "-") : deptFromTree),
      role: "student",
    });
    fetchFlatDepts();
    setShowCreateUser(true);
  };

  const handleCreateUser = async () => {
    if (!newUser.name.trim() || !newUser.username.trim() || !newUser.password.trim()) return;
    setCreatingUser(true);
    setCreateError(null);
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          name: newUser.name.trim(),
          username: newUser.username.trim(),
          password: newUser.password,
          employee_id: newUser.employee_id.trim() || null,
          department: newUser.department.trim() || null,
          role: newUser.role,
        }),
      });
      setShowCreateUser(false);
      await fetchOrg();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingUser(false);
    }
  };

  const openEdit = (row: OrgMemberRow) => {
    const acc = row.account;
    if (!acc) return;
    setEditError(null);
    setEditingUserId(acc.user_id);
    setEditForm({
      name: acc.name,
      username: acc.username,
      employee_id: acc.employee_id || "",
      department: legitDept(acc.department || ""),
      role: acc.role,
      password: "",
    });
    fetchFlatDepts();
    setShowEditUser(true);
  };

  const handleEditUser = async () => {
    if (!editForm.name.trim() || !editForm.username.trim() || !editingUserId) return;
    setEditError(null);
    try {
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
      await fetchOrg();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    const formData = new FormData();
    formData.append("file", importFile);
    const token = localStorage.getItem("lp_token");
    try {
      const res = await fetch(`${BASE}/users/batch-import`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "导入失败");
      setImportResult(result);
      await fetchOrg();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      setImportFile(null);
    }
  };

  // ── 渲染辅助 ──
  const renderBadges = (row: OrgMemberRow) => {
    const acc = row.account;
    if (!acc) return <span className="k-tag">未开通</span>;
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span className={`k-tag ${acc.role === "admin" ? "k-tag-primary" : ""}`}>
          {acc.role === "admin" ? "管理员" : "学员"}
        </span>
        <span className={`k-tag ${acc.status === "active" ? "k-tag-success" : "k-tag-danger"}`}>
          {acc.status === "active" ? "正常" : "已禁用"}
        </span>
        {row.account_count > 1 && (
          <span className="k-tag k-tag-warning" title="该工号存在多个账号，操作作用于最近创建的启用账号">
            ×{row.account_count} 账号
          </span>
        )}
      </span>
    );
  };

  const renderRowActions = (row: OrgMemberRow) => {
    const acc = row.account;
    if (!acc) {
      return (
        <button
          onClick={() => openCreate(row)}
          className="k-link"
        >
          开通账号
        </button>
      );
    }
    return (
      <>
        <button
          onClick={() => handleRoleChange(acc.user_id, acc.role === "admin" ? "student" : "admin")}
          className="k-link mr-3"
        >
          {acc.role === "admin" ? "降为学员" : "提升管理员"}
        </button>
        <button
          onClick={() => handleStatusChange(acc.user_id, acc.status === "active" ? "disabled" : "active")}
          className={`mr-3 ${acc.status === "active" ? "k-link k-link-danger" : "k-link"}`}
        >
          {acc.status === "active" ? "禁用" : "启用"}
        </button>
        <button
          onClick={() => openEdit(row)}
          className="k-link mr-3"
        >
          编辑
        </button>
        <button
          onClick={() => handleDelete(row)}
          className="k-link k-link-danger"
        >
          删除
        </button>
      </>
    );
  };

  return (
    // 页面高度锁定在视口内（100vh − 顶部 header 52 − main 上下 padding 44），
    // 表格区域内部滚动，不再撑开整页
    <div className="flex flex-col h-[calc(100vh-96px)]">
      {/* 标题行：操作按钮统一放在页面右上角 */}
      <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-border shrink-0">
        <h2 className="k-title text-[22px] text-primary">用户管理</h2>
        <div className="flex items-center gap-2">
          {/* VITE_ENABLE_ORG_SYNC=false（生产 .env.production）时隐藏 HR 名册
              导入入口；后端 /api/org/sync、/provision 也受 ORG_SYNC_ENABLED 闸门约束。
              隐藏后融合视图仍完整可用——空镜像时后端以平台账号为名册返回。 */}
          {SYNC_ENABLED && (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="k-btn k-btn-default k-btn-sm disabled:opacity-50"
              >
                <RefreshCw size={12} className={`inline mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "同步中..." : "同步全员"}
              </button>
              <button
                onClick={handleProvision}
                disabled={provisioning || !org?.meta}
                title={
                  org?.meta
                    ? "为名册中所有未开通账号的员工创建无密码学生账号（仅可经 OA/企业微信登录），可重复执行"
                    : "请先同步全员名册"
                }
                className="k-btn k-btn-default k-btn-sm disabled:opacity-50"
              >
                <UserPlus size={12} className="inline mr-1" />
                {provisioning ? "开通中..." : "为全员开通账号"}
              </button>
            </>
          )}
          <button
            onClick={() => openCreate()}
            className="k-btn k-btn-primary k-btn-sm"
          >
            <Plus size={14} className="inline mr-1" />新增用户
          </button>
          <button
            onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); setImportError(null); }}
            className="k-btn k-btn-default k-btn-sm"
          >
            批量导入
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左侧：全员部门树 */}
        <div className="w-60 shrink-0 pr-4 border-r border-border flex flex-col min-h-0">
          <div className="flex-1 min-h-0">
            <OrgDeptTree tree={tree} selectedKey={selectedKey} onSelect={setSelectedKey} />
          </div>
          <button
            onClick={() => setShowDeptModal(true)}
            className="mt-2 shrink-0 w-full k-btn k-btn-default k-btn-sm"
          >
            <Settings2 size={12} /> 平台部门管理
          </button>
        </div>

        {/* 右侧：平铺人员列表 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* 面包屑 + 统计 */}
          <div className="flex items-center gap-1 text-sm mb-2 flex-wrap shrink-0">
            {breadcrumb.map((n, i) => (
              <span key={n.key} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-text-secondary">/</span>}
                <button
                  onClick={() => setSelectedKey(n.key)}
                  className={i === breadcrumb.length - 1 ? "font-medium text-primary" : "text-text-secondary hover:text-primary"}
                >
                  {n.label}
                </button>
              </span>
            ))}
            <span className="ml-2 text-xs text-text-meta">
              共 {activeNode?.total ?? 0} 人 · 直属 {activeNode?.direct ?? 0} 人 · 下级部门 {activeNode?.children.length ?? 0} 个
            </span>
          </div>

          {/* 工具条：仅保留筛选与搜索（操作按钮已移至页面右上角标题行） */}
          <div className="k-filter-bar mb-3 shrink-0">
            <select
              value={scope}
              onChange={e => setScope(e.target.value as "subtree" | "direct")}
              className="k-ctl w-32"
              disabled={accFilter === "unlinked"}
            >
              <option value="subtree">含下级部门</option>
              <option value="direct">仅本部门直属</option>
            </select>
            <select
              value={accFilter}
              onChange={e => setAccFilter(e.target.value as AccFilter)}
              className="k-ctl w-40"
            >
              <option value="all">全部人员</option>
              <option value="has">有平台账号</option>
              <option value="none">未开通账号</option>
              {org?.meta && (
                <option value="unlinked">不在名册的账号（{org.meta.unlinked_account_count}）</option>
              )}
            </select>
            <div className="k-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="搜索姓名/工号/职位/部门..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {syncMsg && (
            <div className={`mb-3 shrink-0 rounded-md border px-3 py-2 text-xs flex items-center justify-between ${
              syncMsg.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"
            }`}>
              <span>{syncMsg.text}</span>
              <button onClick={() => setSyncMsg(null)} className="ml-3 opacity-60 hover:opacity-100">&times;</button>
            </div>
          )}

          {/* 表格卡片：flex-1 撑满剩余高度，内部滚动；表头 sticky 吸顶 */}
          <div className="flex-1 min-h-0 k-table-wrap">
            <div className="h-full k-scroll overflow-y-auto">
            <table className="k-table k-table-sticky table-fixed">
              <thead>
                <tr>
                  <th className="text-center w-24">姓名</th>
                  <th className="text-center w-20">工号</th>
                  <th className="text-center w-32">职位</th>
                  <th className="text-center">部门</th>
                  <th className="text-center w-44">平台账号</th>
                  <th className="text-center w-64">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="k-empty">加载中...</td></tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={6} className="k-empty">
                      <p className="text-danger text-sm mb-2">名册加载失败：{loadError}</p>
                      <button onClick={fetchOrg} className="k-btn k-btn-default k-btn-sm">重试</button>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="k-empty">
                      {!org?.meta ? (
                        SYNC_ENABLED ? (
                          <span>
                            尚未同步全员名册，点击右上角「<button onClick={handleSync} className="text-primary underline mx-0.5" disabled={syncing}>同步全员</button>」从招聘系统拉取全公司人员
                          </span>
                        ) : (
                          "暂无用户，可点击右上角「新增用户」或「批量导入」创建账号"
                        )
                      ) : accFilter === "unlinked" ? (
                        "所有平台账号都已对应到名册中的人员"
                      ) : (
                        "该部门下暂无人员"
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map(row => (
                    <tr
                      key={row.emp_id ? `m-${row.emp_id}` : `u-${row.user_id}`}
                      className={!row.account ? "opacity-80" : ""}
                    >
                      <td className="k-strong text-center truncate" title={row.name}>{row.name}</td>
                      <td className="k-muted text-center">{row.emp_id || row.employee_id || "-"}</td>
                      <td className="text-center truncate" title={row.position || ""}>{row.position || "-"}</td>
                      <td className="k-muted text-center truncate" title={row.dept_path || row.department || ""}>
                        {row.dept_path || row.department || (row.unlinked ? "（不在名册）" : "-")}
                      </td>
                      <td className="text-center">{renderBadges(row)}</td>
                      <td className="text-center whitespace-nowrap">{renderRowActions(row)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/* 前端分页 */}
          {!loading && rows.length > 0 && (
            <div className="flex items-center justify-end gap-3 mt-3 shrink-0 text-xs text-text-meta">
              <span>共 {rows.length} 条 · 第 {page}/{totalPages} 页</span>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="k-btn k-btn-default k-btn-sm disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="k-btn k-btn-default k-btn-sm disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 平台部门管理弹窗 */}
      <DeptManageModal open={showDeptModal} onClose={() => { setShowDeptModal(false); fetchFlatDepts(); }} />

      {/* 批量导入弹窗 */}
      {showImport && (
        <div className="k-overlay" onClick={() => setShowImport(false)}>
          <div className="k-modal max-w-lg k-scroll max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="k-modal-title">批量导入用户</h3>
              <button onClick={() => setShowImport(false)} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">下载模板</p>
                  <p className="text-xs text-text-secondary mb-2">
                    按模板格式填写用户信息；「部门」列填已有部门的完整路径（- 分隔，如：生产部-某某车间-某某班组），
                    部门不存在时该行会被拒绝——新增部门请先在「平台部门管理」创建
                  </p>
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
                    className="k-btn k-btn-default k-btn-sm"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    下载导入模板
                  </button>
                </div>
              </div>

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
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-success"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        <span className="text-sm font-medium text-text-base">{importFile.name}</span>
                        <button onClick={(e) => { e.stopPropagation(); setImportFile(null); }} className="k-link k-link-danger ml-1">移除</button>
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

              {importError && (
                <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
                  {importError}
                </div>
              )}

              {importResult && (
                <div className={`rounded-lg border p-4 text-sm ${
                  importResult.errors.length > 0 ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`font-medium ${importResult.errors.length > 0 ? "text-warning" : "text-success"}`}>
                      导入完成
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-text-secondary">成功 <span className="text-success font-bold">{importResult.success_count}</span> 条</span>
                    <span className="text-text-secondary">跳过 <span className="text-text-secondary font-bold">{importResult.skip_count}</span> 条</span>
                    <span className="text-text-secondary">共 <span className="font-bold">{importResult.total}</span> 条</span>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="mt-2 max-h-28 overflow-y-auto space-y-0.5">
                      {importResult.errors.map((err, i) => (
                        <p key={i} className="text-danger text-xs">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="k-modal-actions px-6 py-4 border-t border-border bg-bg-layout/50">
              <button
                onClick={() => setShowImport(false)}
                className="k-btn k-btn-default"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={!importFile || importing}
                className="k-btn k-btn-primary disabled:opacity-50"
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
        <div className="k-overlay" onClick={() => setShowCreateUser(false)}>
          <div className="k-modal max-w-md k-scroll max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="k-modal-title">新增用户</h3>
              <button onClick={() => setShowCreateUser(false)} className="text-text-secondary hover:text-text-base">
                <span className="text-lg">&times;</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="k-label">姓名 *</label>
                <input
                  type="text" value={newUser.name}
                  onChange={e => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                  className="k-input"
                  placeholder="输入姓名"
                />
              </div>
              <div>
                <label className="k-label">用户名 *</label>
                <input
                  type="text" value={newUser.username}
                  onChange={e => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                  className="k-input"
                  placeholder="输入用户名"
                />
              </div>
              <div>
                <label className="k-label">密码 *</label>
                <input
                  type="password" value={newUser.password}
                  onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                  className="k-input"
                  placeholder="至少 6 位"
                />
              </div>
              <div>
                <label className="k-label">工号</label>
                <input
                  type="text" value={newUser.employee_id}
                  onChange={e => setNewUser(prev => ({ ...prev, employee_id: e.target.value }))}
                  className="k-input"
                  placeholder="输入工号（与全员名册对应，可自动关联账号状态）"
                />
              </div>
              <div>
                <label className="k-label">部门</label>
                <select
                  value={newUser.department}
                  onChange={e => setNewUser(prev => ({ ...prev, department: e.target.value }))}
                  className="k-input"
                >
                  <option value="">（不设置）</option>
                  {deptOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-text-meta mt-1">
                  部门树由「平台部门管理」维护，此处只能从已有部门中选择
                </p>
              </div>
              <div>
                <label className="k-label">角色</label>
                <select
                  value={newUser.role}
                  onChange={e => setNewUser(prev => ({ ...prev, role: e.target.value }))}
                  className="k-select"
                >
                  <option value="student">学员</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              {createError && <p className="text-xs text-danger">{createError}</p>}
            </div>
            <div className="k-modal-actions border-t border-border px-5 py-4">
              <button
                onClick={handleCreateUser}
                disabled={creatingUser}
                className="k-btn k-btn-primary disabled:opacity-50"
              >
                {creatingUser ? "创建中..." : "创建"}
              </button>
              <button
                onClick={() => setShowCreateUser(false)}
                className="k-btn k-btn-default"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑用户弹窗 */}
      {showEditUser && (
        <div className="k-overlay" onClick={() => { setShowEditUser(false); setEditingUserId(null); }}>
          <div className="k-modal max-w-md k-scroll max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="k-modal-title">编辑用户</h3>
              <button onClick={() => { setShowEditUser(false); setEditingUserId(null); }} className="text-text-secondary hover:text-text-base">
                <span className="text-lg">&times;</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="k-label">姓名 *</label>
                <input
                  type="text" value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="k-input"
                />
              </div>
              <div>
                <label className="k-label">用户名 *</label>
                <input
                  type="text" value={editForm.username}
                  onChange={e => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                  className="k-input"
                />
              </div>
              <div>
                <label className="k-label">新密码（留空不修改）</label>
                <input
                  type="password" value={editForm.password}
                  onChange={e => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                  className="k-input"
                  placeholder="留空则不修改密码"
                />
              </div>
              <div>
                <label className="k-label">工号</label>
                <input
                  type="text" value={editForm.employee_id}
                  onChange={e => setEditForm(prev => ({ ...prev, employee_id: e.target.value }))}
                  className="k-input"
                />
              </div>
              <div>
                <label className="k-label">部门</label>
                <select
                  value={editForm.department}
                  onChange={e => setEditForm(prev => ({ ...prev, department: e.target.value }))}
                  className="k-input"
                >
                  <option value="">（清除部门）</option>
                  {deptOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="k-label">角色</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value }))}
                  className="k-select"
                >
                  <option value="student">学员</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              {editError && <p className="text-xs text-danger">{editError}</p>}
            </div>
            <div className="k-modal-actions border-t border-border px-5 py-4">
              <button
                onClick={handleEditUser}
                className="k-btn k-btn-primary"
              >
                保存
              </button>
              <button
                onClick={() => { setShowEditUser(false); setEditingUserId(null); }}
                className="k-btn k-btn-default"
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
