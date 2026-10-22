import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import {
  BookOpen, Library, Pencil, ClipboardList, ScrollText,
  Users, BarChart3, LayoutDashboard, FileText,
  ChevronsLeft, ChevronsRight, ChevronDown, Search, Bell, LogOut, UserCog,
} from "lucide-react";
import logoImg from "../assets/logo.png";

// 路由级按需加载：各页面及其重型依赖（播放器 / 课件预览 / 知识地图画布等）
// 仅在访问对应路由时才下载，避免全部页面代码进入首屏。
const AdminDashboard = lazy(() => import("../pages/admin/Dashboard"));
const CourseManage = lazy(() => import("../pages/admin/CourseManage"));
const QuestionBank = lazy(() => import("../pages/admin/QuestionBank"));
const PaperManage = lazy(() => import("../pages/admin/PaperManage"));
const ExamManage = lazy(() => import("../pages/admin/ExamManage"));
const ExamPaper = lazy(() => import("../pages/admin/ExamPaper"));
const PaperDetail = lazy(() => import("../pages/admin/PaperDetail"));
const ExamResults = lazy(() => import("../pages/admin/ExamResults"));
const UserProgress = lazy(() => import("../pages/admin/UserProgress"));
const DepartmentUserManage = lazy(() => import("../pages/admin/DepartmentUserManage"));
const UserManage = lazy(() => import("../pages/admin/UserManage"));
const QuestionManage = lazy(() => import("../pages/admin/QuestionManage"));
const KnowledgeManage = lazy(() => import("../pages/admin/KnowledgeManage"));
const LogViewer = lazy(() => import("../pages/admin/LogViewer"));
const CoursePreview = lazy(() => import("../pages/admin/CoursePreview"));
const AttendanceBoard = lazy(() => import("../pages/admin/AttendanceBoard"));
import CommandPalette, { useCommandHotkey } from "../components/CommandPalette";

const menuGroups = [
  {
    label: "",
    items: [{ icon: LayoutDashboard, label: "首页", path: "/admin" }],
  },
  {
    label: "资源管理",
    items: [
      { icon: BookOpen, label: "课程管理", path: "/admin/courses" },
      { icon: Library, label: "知识管理", path: "/admin/knowledge" },
    ],
  },
  {
    label: "考试管理",
    items: [
      { icon: Pencil, label: "试题管理", path: "/admin/question-bank" },
      { icon: ClipboardList, label: "试卷管理", path: "/admin/papers" },
      { icon: ScrollText, label: "考试管理", path: "/admin/exams" },
    ],
  },
  {
    label: "人员管理",
    items: [
      { icon: Users, label: "用户管理", path: "/admin/users" },
      { icon: BarChart3, label: "学员进度", path: "/admin/users/progress" },
    ],
  },
  {
    label: "系统",
    items: [
      { icon: FileText, label: "系统日志", path: "/admin/logs" },
    ],
  },
];

interface LogItem {
  id: string;
  operator: string;
  action: string;
  resource_name: string;
  level: string;
  created_at: string;
}

export default function AdminLayout() {
  const { user, logout, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("lp_admin_sidebar_collapsed") === "1"
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("lp_admin_open_groups") || "{}");
    } catch {
      return {};
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useCommandHotkey(setPaletteOpen);

  useEffect(() => {
    localStorage.setItem("lp_admin_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem("lp_admin_open_groups", JSON.stringify(openGroups));
  }, [openGroups]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setBellOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    api<{ items: LogItem[]; total: number }>("/admin/system-logs?level=error&page_size=8")
      .then((data) => {
        setLogs(data.items ?? []);
        setUnread(data.total ?? 0);
      })
      .catch(() => {});
  }, [location.pathname]);

  if (loading) return null;
  if (!user || user.role !== "admin") return <Navigate to="/student" replace />;

  const isActive = (path: string) => {
    const p = location.pathname;
    if (path === "/admin") return p === "/admin";
    if (p === path) return true;
    if (!p.startsWith(path + "/")) return false;
    for (const group of menuGroups) {
      for (const item of group.items) {
        if (
          item.path !== path &&
          (p === item.path || p.startsWith(item.path + "/")) &&
          item.path.length > path.length
        ) {
          return false;
        }
      }
    }
    return true;
  };

  const groupOpen = (label: string) => openGroups[label] !== false;

  return (
    <div ref={rootRef} className="min-h-screen flex" style={{ background: "var(--color-bg-layout)" }}>
      <aside
        className="shrink-0 flex flex-col"
        style={{
          width: collapsed ? 60 : 200,
          background: "var(--color-bg-card)",
          borderRight: "1px solid var(--color-border)",
          transition: "width 180ms ease",
          // 钉在视口：内容再长侧边栏也不跟随滚动，收起按钮始终在视口底部
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div
          className="flex items-center gap-2"
          style={{
            height: 52,
            padding: collapsed ? "0 12px" : "0 14px",
            borderBottom: "1px solid var(--color-border)",
            justifyContent: "center",
          }}
        >
          {!collapsed && (
            <span
              className="k-title"
              style={{ fontSize: 13, color: "var(--color-primary)", whiteSpace: "nowrap" }}
            >
              海创在线学堂
            </span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto" style={{ padding: "8px 8px 12px", minHeight: 0 }}>
          {menuGroups.map((group, gi) => {
            const key = group.label || `g${gi}`;
            const open = group.label === "" ? true : groupOpen(key);
            return (
              <div key={key} style={{ marginBottom: 2 }}>
                {group.label && !collapsed && (
                  <button
                    onClick={() =>
                      setOpenGroups((prev) => ({ ...prev, [key]: !open }))
                    }
                    className="k-nav-group-label"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {group.label}
                    <ChevronDown
                      size={11}
                      style={{
                        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform 160ms ease",
                      }}
                    />
                  </button>
                )}
                {group.label && collapsed && (
                  <div style={{ height: 1, background: "var(--color-border)", margin: "10px 6px" }} />
                )}
                {(open || collapsed) &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.path);
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`k-nav-item ${active ? "k-nav-item-active" : ""}`}
                        style={collapsed
                          // 收起态：图标在上、导航文字在下（60px 轨道容纳 4 字 10px 标签）
                          ? { flexDirection: "column", justifyContent: "center", gap: 3, padding: "7px 0 6px" }
                          : { justifyContent: "flex-start" }}
                      >
                        {/* 选中态仅浅底+主色文字，无指示条（.k-nav-item-active），勿再叠加内联 span */}
                        <Icon size={16} strokeWidth={1.6} />
                        <span
                          style={collapsed
                            ? { fontSize: 10, lineHeight: 1.2, whiteSpace: "nowrap" }
                            : undefined}
                        >
                          {item.label}
                        </span>
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="k-link"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            height: 36,
            borderTop: "1px solid var(--color-border)",
            fontSize: 12,
          }}
        >
          {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          {!collapsed && "收起侧边栏"}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="flex items-center justify-between"
          style={{
            height: 52,
            padding: "0 20px",
            background: "var(--color-bg-card)",
            borderBottom: "1px solid var(--color-border)",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={logoImg} alt="海创光电" style={{ height: 18 }} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="k-btn k-btn-default k-btn-sm"
              style={{ color: "var(--color-text-muted)", gap: 8 }}
            >
              <Search size={13} /> 搜索
              <span style={{ fontSize: 10, opacity: 0.7 }}>⌘K</span>
            </button>

            <div style={{ position: "relative" }}>
              <button
                onClick={() => {
                  setBellOpen((v) => !v);
                  setMenuOpen(false);
                }}
                className="k-btn k-btn-ghost k-btn-sm"
                style={{ padding: "5px 8px", position: "relative" }}
                aria-label="异常日志"
              >
                <Bell size={15} />
                {unread > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      minWidth: 14,
                      height: 14,
                      borderRadius: 7,
                      background: "var(--color-danger)",
                      color: "#fff",
                      fontSize: 10,
                      lineHeight: "14px",
                      padding: "0 3px",
                    }}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div
                  className="k-card"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 34,
                    width: 300,
                    zIndex: 50,
                    boxShadow: "0 4px 16px rgba(20,20,19,0.08)",
                  }}
                >
                  <div
                    style={{
                      padding: "9px 14px",
                      borderBottom: "1px solid var(--color-border)",
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    异常日志 · 共 {unread} 条
                  </div>
                  <div style={{ maxHeight: 260, overflowY: "auto" }}>
                    {logs.length === 0 ? (
                      <div className="k-empty" style={{ padding: "20px 12px" }}>
                        暂无异常记录
                      </div>
                    ) : (
                      logs.map((l) => (
                        <div
                          key={l.id}
                          style={{
                            padding: "9px 14px",
                            borderBottom: "1px solid rgba(232,230,220,0.7)",
                          }}
                        >
                          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                            {l.operator} · {l.action}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                            {l.resource_name || "-"} ·{" "}
                            {new Date(l.created_at).toLocaleString("zh-CN")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <Link
                    to="/admin/logs"
                    onClick={() => setBellOpen(false)}
                    className="k-link"
                    style={{
                      display: "block",
                      textAlign: "center",
                      padding: "8px 0",
                      borderTop: "1px solid var(--color-border)",
                      fontSize: 12,
                    }}
                  >
                    查看全部日志
                  </Link>
                </div>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <button
                onClick={() => {
                  setMenuOpen((v) => !v);
                  setBellOpen(false);
                }}
                className="k-btn k-btn-ghost k-btn-sm"
                style={{ gap: 6 }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "rgba(27,54,93,0.08)",
                    color: "var(--color-primary)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                  }}
                >
                  {user?.name?.slice(0, 1) ?? "管"}
                </span>
                <span style={{ fontSize: 12 }}>{user?.name}</span>
                <ChevronDown size={12} />
              </button>
              {menuOpen && (
                <div
                  className="k-card"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 34,
                    width: 168,
                    zIndex: 50,
                    padding: "4px 0",
                    boxShadow: "0 4px 16px rgba(20,20,19,0.08)",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 14px",
                      borderBottom: "1px solid var(--color-border)",
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {user?.department || "管理员"} · {user?.role === "admin" ? "管理员" : "学员"}
                  </div>
                  <Link
                    to="/student"
                    className="k-nav-item"
                    style={{ borderRadius: 0, fontSize: 13 }}
                  >
                    <UserCog size={14} /> 切换学员视图
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      navigate("/login");
                    }}
                    className="k-nav-item"
                    style={{
                      width: "100%",
                      borderRadius: 0,
                      fontSize: 13,
                      background: "none",
                      border: "none",
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <LogOut size={14} /> 退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1" style={{ padding: 22, minWidth: 0 }}>
          <Suspense
          fallback={
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-text-secondary text-sm">加载中...</p>
              </div>
            </div>
          }
        >
        <Routes>
            <Route index element={<AdminDashboard />} />
            <Route path="courses/:id" element={<CoursePreview />} />
            {/* 编辑已并入课程抽屉（与新建同界面）；旧编辑地址重定向回列表 */}
            <Route path="courses/new" element={<Navigate to="/admin/courses" replace />} />
            <Route path="courses/:id/edit" element={<Navigate to="/admin/courses" replace />} />
            <Route path="courses" element={<CourseManage />} />
            <Route path="question-bank" element={<QuestionBank />} />
            <Route path="questions" element={<QuestionManage />} />
            <Route path="knowledge" element={<KnowledgeManage />} />
            <Route path="papers" element={<PaperManage />} />
            <Route path="papers/:id" element={<PaperDetail />} />
            <Route path="exams" element={<ExamManage />} />
            <Route path="exams/:id/paper" element={<ExamPaper />} />
            <Route path="exams/:id/results" element={<ExamResults />} />
            <Route path="users/progress" element={<UserProgress />} />
            <Route path="users/manage" element={<UserManage />} />
            <Route path="users" element={<DepartmentUserManage />} />
            <Route path="logs" element={<LogViewer />} />
            {/* 投屏二维码页：全屏 fixed 布局，仍需登录态，因此挂在 AdminLayout 下 */}
            <Route path="attendance/:sessionId/board" element={<AttendanceBoard />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Suspense>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}