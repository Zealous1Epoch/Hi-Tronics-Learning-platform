import { Routes, Route, Link, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import NoticeBell from "../components/NoticeBell";
import StudentDashboard from "../pages/student/Dashboard";
import MyCourses from "../pages/student/MyCourses";
import CourseDetail from "../pages/student/CourseDetail";
import ExamPage from "../pages/student/ExamPage";
import StudentProfile from "../pages/student/Profile";

export default function StudentLayout() {
  const { user, logout, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-bg-layout">
      <nav className="bg-primary text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">海创光电在线学堂</h1>
          <Link to="/student" className="text-white/80 hover:text-white text-sm">首页</Link>
          <Link to="/student/courses" className="text-white/80 hover:text-white text-sm">我的课程</Link>
          <Link to="/student/profile" className="text-white/80 hover:text-white text-sm">学习档案</Link>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === "admin" && (
            <Link to="/admin" className="text-sm text-white/80 hover:text-white">管理后台</Link>
          )}
          <NoticeBell />
          <span className="text-sm text-white/70">{user?.name}</span>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white">退出</button>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-6">
        <Routes>
          <Route index element={<StudentDashboard />} />
          <Route path="courses" element={<MyCourses />} />
          <Route path="courses/:id" element={<CourseDetail />} />
          <Route path="exams/:id" element={<ExamPage />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </main>
    </div>
  );
}