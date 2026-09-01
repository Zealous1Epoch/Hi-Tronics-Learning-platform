import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import AdminDashboard from "../pages/admin/Dashboard";
import CourseManage from "../pages/admin/CourseManage";
import CourseEdit from "../pages/admin/CourseEdit";
import CourseAssign from "../pages/admin/CourseAssign";
import QuestionManage from "../pages/admin/QuestionManage";
import ExamManage from "../pages/admin/ExamManage";
import ExamPaper from "../pages/admin/ExamPaper";
import ExamResults from "../pages/admin/ExamResults";
import UserProgress from "../pages/admin/UserProgress";
import UserManage from "../pages/admin/UserManage";
import DepartmentManage from "../pages/admin/DepartmentManage";
import TagManage from "../pages/admin/TagManage";
import CategoryManage from "../pages/admin/CategoryManage";

const menuItems = [
  { label: "首页", path: "/admin" },
  { label: "课程管理", path: "/admin/courses" },
  { label: "题库管理", path: "/admin/questions" },
  { label: "题库分类", path: "/admin/categories" },
  { label: "标签管理", path: "/admin/tags" },
  { label: "考试管理", path: "/admin/exams" },
  { label: "学员进度", path: "/admin/users/progress" },
  { label: "用户管理", path: "/admin/users" },
  { label: "部门管理", path: "/admin/departments" },
];

export default function AdminLayout() {
  const { user, logout, loading } = useAuth();

  if (loading) return null;
  if (!user || user.role !== "admin") return <Navigate to="/student" replace />;

  return (
    <div className="min-h-screen flex bg-bg-layout">
      <aside className="w-56 bg-primary text-white min-h-screen p-4 flex-shrink-0">
        <h2 className="text-lg font-bold mb-6">学习管理后台</h2>
        <nav className="flex flex-col gap-1 text-sm">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="px-3 py-2 rounded hover:bg-white/10 transition-colors"
            >
              {item.label}
            </Link>
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
            <Route path="courses/:id/edit" element={<CourseEdit />} />
            <Route path="courses/:id/assign" element={<CourseAssign />} />
            <Route path="questions" element={<QuestionManage />} />
            <Route path="categories" element={<CategoryManage />} />
            <Route path="tags" element={<TagManage />} />
            <Route path="exams" element={<ExamManage />} />
            <Route path="exams/:id/paper" element={<ExamPaper />} />
            <Route path="exams/:id/results" element={<ExamResults />} />
            <Route path="users/progress" element={<UserProgress />} />
            <Route path="users" element={<UserManage />} />
            <Route path="departments" element={<DepartmentManage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}