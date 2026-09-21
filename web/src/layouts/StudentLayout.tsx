import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ChevronDown, LogOut, LayoutDashboard } from "lucide-react";

// 路由级按需加载：各页面及其重型依赖（播放器 / 课件预览 / 知识地图画布等）
// 仅在访问对应路由时才下载，避免全部页面代码进入首屏。
const StudentDashboard = lazy(() => import("../pages/student/Dashboard"));
const TodoTasks = lazy(() => import("../pages/student/TodoTasks"));
const MyCourses = lazy(() => import("../pages/student/MyCourses"));
const CourseDetail = lazy(() => import("../pages/student/CourseDetail"));
const ExamPage = lazy(() => import("../pages/student/ExamPage"));
const StudentProfile = lazy(() => import("../pages/student/Profile"));
const KnowledgeBrowse = lazy(() => import("../pages/student/KnowledgeBrowse"));
const ScanCheckIn = lazy(() => import("../pages/student/ScanCheckIn"));
import logoImg from "../assets/logo.png";

const navItems = [
  { label: "首页", to: "/student" },
  { label: "代办任务", to: "/student/tasks" },
  { label: "我的课程", to: "/student/courses" },
  { label: "知识地图", to: "/student/knowledge" },
  { label: "学习档案", to: "/student/profile" },
];

export default function StudentLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (loading) return null;
  if (!user)
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );

  return (
    <div ref={rootRef} className="min-h-screen" style={{ background: "var(--color-bg-layout)" }}>
      <header
        style={{
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ maxWidth: 1400, margin: "0 auto", padding: "0 16px", height: 56, gap: 20 }}
        >
          <div className="flex items-center gap-6" style={{ minWidth: 0 }}>
            <img src={logoImg} alt="海创光电" style={{ height: 24, flexShrink: 0 }} />
            <nav className="flex items-center gap-1" style={{ overflowX: "auto" }}>
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/student"}
                  style={({ isActive }) => ({
                    position: "relative",
                    padding: "6px 10px",
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    color: isActive ? "var(--color-primary)" : "var(--color-text-secondary)",
                    fontWeight: isActive ? 500 : 400,
                    textDecoration: "none",
                  })}
                >
                  {({ isActive }) => (
                    <>
                      {item.label}
                      {isActive && (
                        <span
                          style={{
                            position: "absolute",
                            left: 10,
                            right: 10,
                            bottom: -1,
                            height: 2,
                            background: "var(--color-primary)",
                            borderRadius: 1,
                          }}
                        />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2" style={{ position: "relative", flexShrink: 0 }}>
            {user?.role === "admin" && (
              <Link to="/admin" className="k-btn k-btn-default k-btn-sm">
                <LayoutDashboard size={13} /> 管理后台
              </Link>
            )}
            <button
              onClick={() => setMenuOpen((v) => !v)}
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
                {user?.name?.slice(0, 1) ?? "学"}
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
                  width: 160,
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
                  {user?.department || "学员"}
                </div>
                <button
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="k-nav-item"
                  style={{
                    width: "100%",
                    borderRadius: 0,
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

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px" }}>
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
          <Route index element={<StudentDashboard />} />
          <Route path="tasks" element={<TodoTasks />} />
          <Route path="courses" element={<MyCourses />} />
          <Route path="courses/:id" element={<CourseDetail />} />
          <Route path="exams/:id" element={<ExamPage />} />
          <Route path="knowledge" element={<KnowledgeBrowse />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="checkin/:sessionId" element={<ScanCheckIn />} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}