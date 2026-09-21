import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, MapPin, User } from "lucide-react";
import { api } from "../../lib/api";

interface ExchangeResult {
  ok: boolean;
  status: string;
  message: string;
  course_title: string;
  session_title: string;
  user_name: string;
  checked_in_at: string | null;
  risk_flags: string[];
}

/**
 * 企业微信扫码回调页（手机端，无需登录平台）。
 *
 * 学员用企业微信扫投屏二维码 → 企微静默授权 → 重定向到本页（带 code + state）。
 * 本页把 code/state 交给后端 /student/wecom/exchange，由后端用 code 换企微身份、
 * 匹配培训账号并直接签到，全程学员零输入、零登录。
 *
 * 注意：本页置于登录守卫之外（App.tsx 顶级路由），因为身份由企微 OAuth 背书。
 */
export default function WecomCheckInCallback() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ExchangeResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const code = searchParams.get("code") || "";
    const state = searchParams.get("state") || "";
    if (!code || !state) {
      setLoading(false);
      setError("缺少授权参数，请重新扫描投屏上的二维码");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await api<ExchangeResult>(
          `/student/wecom/exchange?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        );
        if (alive) {
          setResult(res);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "签到失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-layout px-6">
      <div className="max-w-md w-full">
        {loading && (
          <div className="text-center">
            <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-text-secondary">正在签到...</p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 text-red-600 p-6 text-center">
            <XCircle size={44} className="mx-auto mb-3" />
            <p className="font-medium mb-1">签到未成功</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 p-6 text-center">
            <CheckCircle2 size={44} className="mx-auto mb-3" />
            <p className="text-lg font-bold mb-3">签到成功</p>
            <div className="text-left text-sm space-y-2 bg-white/70 rounded-md p-4">
              <div className="flex items-center gap-2 text-text-base">
                <User size={14} className="text-text-secondary" /> {result.user_name}
              </div>
              <div className="flex items-center gap-2 text-text-base">
                <MapPin size={14} className="text-text-secondary" /> {result.course_title}
              </div>
              <div className="flex items-center gap-2 text-text-base">
                <Clock size={14} className="text-text-secondary" /> {result.session_title}
              </div>
              {result.checked_in_at && (
                <div className="text-text-secondary text-xs pt-1">
                  签到时间：{new Date(result.checked_in_at).toLocaleString("zh-CN")}
                </div>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-4">
              你可以关闭此页面；无需在手机上登录平台
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
