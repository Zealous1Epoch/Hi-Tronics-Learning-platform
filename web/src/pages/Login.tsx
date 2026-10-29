import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

// 企微内置浏览器自动登录：检测到 wxwork UA 且未登录时，直接发起 OAuth，
// 免去在登录页手动点「企业微信登录」按钮的一步。
// 防死循环：授权失败会被后端 302 回本页，若无节流会再次自动跳转形成循环，
// 故用 sessionStorage 记录最近一次自动跳转时间，冷却期内不再自动跳（回退为手动按钮）。
const WX_AUTO_KEY = "lp_wx_auto_ts";
const WX_AUTO_COOLDOWN_MS = 60_000;

// 清洗 redirect 查询参数：api.ts 的 401 处理器写入的 redirect 是
// window.location.pathname，自带 /learning-platform 部署前缀；直接交给
// react-router 的 navigate 会二次拼接 basename 落到兜底路由、再被弹回
// 登录页形成循环。只接受站内绝对路径并剥掉部署前缀（顺带防开放重定向）。
function safeRedirect(raw: string | null): string | undefined {
  if (!raw || !raw.startsWith("/")) return undefined;
  const stripped = raw.replace(/^\/learning-platform(?=\/|$)/, "");
  return stripped.startsWith("/") ? stripped : undefined;
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoRedirecting, setAutoRedirecting] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, setUser } = useAuth();

  // 登录态有效（典型场景：企微自动 OAuth 已完成、但被过期旧 token 的迟到
  // 401 弹回了登录页）→ 直接进对应首页，不给已登录用户展示登录表单。
  useEffect(() => {
    if (authLoading || !user) return;
    const redirect = safeRedirect(searchParams.get("redirect"));
    navigate(redirect || (user.role === "admin" ? "/admin" : "/student"), { replace: true });
  }, [authLoading, user, navigate, searchParams]);

  useEffect(() => {
    // 先等 AuthProvider 校验完：避免把残留的过期 token 误当登录态跳过自动登录，
    // 也避免给其实已持有有效 token 的用户白闪一次 OAuth。
    if (authLoading || user) return;
    if (!/wxwork/i.test(navigator.userAgent)) return;
    const last = Number(sessionStorage.getItem(WX_AUTO_KEY) || 0);
    if (Date.now() - last < WX_AUTO_COOLDOWN_MS) return; // 刚自动跳过一次又回到登录页 = 授权失败，别再循环
    sessionStorage.setItem(WX_AUTO_KEY, String(Date.now()));
    setAutoRedirecting(true);
    // 与「企业微信登录」按钮同一入口：后端生成 state 后跳企微授权页
    window.location.replace("/learning-platform/sso/wechat/login");
  }, [authLoading, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(username, password);
      localStorage.setItem("lp_token", res.access_token);
      localStorage.setItem("lp_user", JSON.stringify(res.user));
      setUser(res.user);
      const redirect = safeRedirect(searchParams.get("redirect"));
      navigate(redirect || (res.user.role === "admin" ? "/admin" : "/student"), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  if (autoRedirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-layout">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-text-secondary">正在通过企业微信登录...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-layout px-4">
      <div className="bg-bg-base rounded-lg shadow-lg p-6 sm:p-12 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary mb-2">海创光电在线学堂</h1>
          <p className="text-text-secondary">企业在线学习平台</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2.5 text-[16px] sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="请输入用户名"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2.5 text-[16px] sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="请输入密码"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white py-3 rounded-md hover:bg-primary-light transition-colors disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-bg-base px-2 text-text-secondary">其他方式</span>
          </div>
        </div>

        <a
          href="/learning-platform/sso/wechat/login"
          className="flex items-center justify-center w-full border border-border rounded-md px-3 py-2.5 text-sm text-text-secondary hover:bg-gray-50 transition-colors"
        >
          <svg className="w-5 h-5 mr-2 text-green-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.134 0 .24-.11.24-.245 0-.06-.024-.12-.04-.178l-.325-1.233a.492.492 0 0 1 .178-.553C23.028 18.333 24 16.592 24 14.628c0-3.299-3.063-5.77-7.062-5.77zm-2.18 2.453c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.36 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982z"/>
          </svg>
          企业微信登录
        </a>

      </div>
    </div>
  );
}