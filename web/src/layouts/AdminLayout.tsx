import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  BookOpen, Library, Pencil, ClipboardList, ScrollText,
  Users, BarChart3, LayoutDashboard, FileText,
} from "lucide-react";
import AdminDashboard from "../pages/admin/Dashboard";
import CourseManage from "../pages/admin/CourseManage";
import QuestionBank from "../pages/admin/QuestionBank";
import PaperManage from "../pages/admin/PaperManage";
import ExamManage from "../pages/admin/ExamManage";
import ExamPaper from "../pages/admin/ExamPaper";
import ExamResults from "../pages/admin/ExamResults";
import UserProgress from "../pages/admin/UserProgress";
import DepartmentUserManage from "../pages/admin/DepartmentUserManage";
import KnowledgeManage from "../pages/admin/KnowledgeManage";
import LogViewer from "../pages/admin/LogViewer";

const menuGroups = [
  {
    label: "",
    items: [
      { icon: LayoutDashboard, label: "首页", path: "/admin" },
    ],
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

export default function AdminLayout() {
  const { user, logout, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user || user.role !== "admin") return <Navigate to="/student" replace />;

  const isActive = (path: string) => {
    if (path === "/admin") return location.pathname === "/admin";
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex bg-bg-layout">
      <aside className="w-36 bg-primary text-white min-h-screen flex-shrink-0 flex flex-col">
        <h2 className="text-sm font-bold px-4 py-4 border-b border-white/10">学习管理后台</h2>
        <nav className="flex-1 py-2 overflow-y-auto">
          {menuGroups.map((group) => (
            <div key={group.label || "home"} className="mb-3">
              {group.label && (
                <p className="px-4 py-1 text-[10px] text-white/40 uppercase tracking-wider">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                      active
                        ? "bg-white/15 text-white font-medium"
                        : "text-white/70 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-bg-base border-b border-border px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-text-secondary">管理后台</span>
          <div className="flex items-center gap-3">
            <Link to="/student" className="text-sm text-primary hover:underline">切换学员视图</Link>
            <span className="text-sm text-text-secondary">{user?.name}</span>
            <button onClick={logout} className="text-sm text-text-secondary hover:text-text-base">退出</button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Routes>
            <Route index element={<AdminDashboard />} />
            <Route path="courses" element={<CourseManage />} />
            <Route path="question-bank" element={<QuestionBank />} />
            <Route path="knowledge" element={<KnowledgeManage />} />
            <Route path="papers" element={<PaperManage />} />
            <Route path="exams" element={<ExamManage />} />
            <Route path="exams/:id/paper" element={<ExamPaper />} />
            <Route path="exams/:id/results" element={<ExamResults />} />
            <Route path="users/progress" element={<UserProgress />} />
            <Route path="users" element={<DepartmentUserManage />} />
            <Route path="logs" element={<LogViewer />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}