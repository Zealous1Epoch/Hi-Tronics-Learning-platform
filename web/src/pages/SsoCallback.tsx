import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { getMe, BASE } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export default function SsoCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("缺少 code 参数");
      return;
    }

    // 用一次性 code 换取 JWT token（避免 token 暴露在 URL 中）
    // 修复：原先用 BASE_URL（= /learning-platform/）拼接，得到
    // /learning-platform/sso/exchange —— 既不在 dev 代理前缀（/sso、/api）内，
    // 生产环境也不会被 nginx 转发到后端，必然 404。
    // 现改用统一的 API 前缀 BASE（/api/learning-platform），后端已提供
    // /api/sso/exchange 别名，开发与生产行为一致。
    fetch(`${BASE}sso/exchange?code=${encodeURIComponent(code)}`)
      .then((res) => {
        if (!res.ok) throw new Error("code 无效或已过期");
        return res.json();
      })
      .then((data) => {
        const token = data.token;
        if (!token) throw new Error("token 为空");
        localStorage.setItem("lp_token", token);
        return getMe();
      })
      .then((user) => {
        localStorage.setItem("lp_user", JSON.stringify(user));
        setUser(user);
        navigate(user.role === "admin" ? "/admin" : "/student", { replace: true });
      })
      .catch(() => {
        localStorage.removeItem("lp_token");
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