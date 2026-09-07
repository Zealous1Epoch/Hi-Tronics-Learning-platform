import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import ErrorBoundary from "./components/ErrorBoundary";
import StudentLayout from "./layouts/StudentLayout";
import AdminLayout from "./layouts/AdminLayout";
import Login from "./pages/Login";
import SsoCallback from "./pages/SsoCallback";

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter basename="/learning-platform">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/sso/callback" element={<SsoCallback />} />
            <Route path="/student/*" element={<StudentLayout />} />
            <Route path="/admin/*" element={<AdminLayout />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;