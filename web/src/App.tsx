import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import ErrorBoundary from "./components/ErrorBoundary";
import { ConfirmProvider } from "./components/ui/Confirm";
import { ToastProvider } from "./components/ui/Toast";
import Login from "./pages/Login";
import SsoCallback from "./pages/SsoCallback";
import WecomCheckInCallback from "./pages/student/WecomCheckInCallback";
import PublicCheckIn from "./pages/student/PublicCheckIn";

// 路由级代码分割：登录页不再需要下载学员端 / 管理端的全部代码。
// 修复前所有页面静态引入，首屏单包 2.68MB（gzip 774KB）。
const StudentLayout = lazy(() => import("./layouts/StudentLayout"));
const AdminLayout = lazy(() => import("./layouts/AdminLayout"));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-layout">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-text-secondary text-sm">加载中...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfirmProvider>
          <ToastProvider>
            <BrowserRouter basename="/learning-platform">
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/sso/callback" element={<SsoCallback />} />
                  <Route path="/wecom/checkin" element={<WecomCheckInCallback />} />
                  <Route path="/checkin/:sessionId" element={<PublicCheckIn />} />
                  <Route path="/student/*" element={<StudentLayout />} />
                  <Route path="/admin/*" element={<AdminLayout />} />
                  <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ToastProvider>
        </ConfirmProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
