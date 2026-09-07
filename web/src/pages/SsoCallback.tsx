import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { getMe } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export default function SsoCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("缺少 token 参数");
      return;
    }

    localStorage.setItem("token", token);

    getMe()
      .then((user) => {
        localStorage.setItem("user", JSON.stringify(user));
        setUser(user);
        navigate(user.role === "admin" ? "/admin" : "/student", { replace: true });
      })
      .catch(() => {
        localStorage.removeItem("token");
        setError("SSO 登录验证失败，请重试");
      });
  }, [searchParams, navigate, setUser]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-layout">
        <div className="bg-bg-base rounded-lg shadow-lg p-12 w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-primary mb-4">登录失败</h1>
          <p className="text-text-secondary mb-6">{error}</p>
          <Link
            to="/login"
            className="inline-block bg-primary text-white px-6 py-3 rounded-md hover:bg-primary-light transition-colors"
          >
            返回登录页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-layout">
      <div className="text-center">
        <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-text-secondary">正在登录...</p>
      </div>
    </div>
  );
}