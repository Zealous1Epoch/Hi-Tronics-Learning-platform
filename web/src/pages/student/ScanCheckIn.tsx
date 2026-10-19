import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, MapPin, ArrowLeft } from "lucide-react";
import { api } from "../../lib/api";
import { getDeviceId } from "../../lib/device";

interface SessionCode {
  session_id: string;
  course_id: string;
  session_title: string;
  course_title: string;
  location_name: string | null;
  code: string;
  state: string;
}

const STATE_LABEL: Record<string, string> = {
  upcoming: "签到尚未开始",
  open: "签到进行中",
  closed: "签到已结束",
};

/**
 * 学员扫码落地页（手机浏览器打开）。
 *
 * 投屏二维码只编码本页链接 + 场次 ID，签到码轮换已废除（2026-10-19），
 * 码在本场次内固定；点「确认签到」时仍实时取一次码提交，保证与服务端一致。
 */
export default function ScanCheckIn() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<SessionCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // result.ok: 成功；result.done: 已签到过；result.fail: 失败
  const [result, setResult] = useState<{ kind: "ok" | "done" | "fail"; text: string } | null>(null);
  const aliveRef = useRef(true);

  const load = async () => {
    try {
      const res = await api<SessionCode>(`/student/attendance/sessions/${sessionId}/code`);
      if (!aliveRef.current) return;
      setInfo(res);
      setError("");
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    load();
    // 5 秒刷新一次场次状态（未开始/进行中/已结束）；签到码本身固定不变
    const poll = setInterval(load, 5000);
    return () => {
      aliveRef.current = false;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const submit = async () => {
    if (!sessionId || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      // 提交前再取一次最新码，确保未过期
      const fresh = await api<SessionCode>(`/student/attendance/sessions/${sessionId}/code`);
      const res = await api<{ ok: boolean; status: string; message: string }>(
        `/student/attendance/${sessionId}/checkin`,
        {
          method: "POST",
          body: JSON.stringify({ code: fresh.code, device_id: getDeviceId() }),
        },
      );
      setResult({ kind: "ok", text: res.message || "签到成功" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "签到失败";
      // 已签到过的提示归为「done」，不让学员误以为失败
      if (msg.includes("已完成") || msg.includes("无需重复")) {
        setResult({ kind: "done", text: "你已完成本场次签到" });
      } else {
        setResult({ kind: "fail", text: msg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-text-secondary">加载中...</p>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center px-6">
        <XCircle size={48} className="text-red-500 mx-auto mb-4" />
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => navigate("/student/courses")} className="text-primary hover:underline">
          返回我的课程
        </button>
      </div>
    );
  }

  const state = info?.state ?? "closed";

  return (
    <div className="max-w-md mx-auto mt-16 px-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-base mb-6"
      >
        <ArrowLeft size={14} /> 返回
      </button>

      {info && (
        <div className="text-center mb-6">
          <h1 className="text-lg font-bold text-primary">{info.course_title}</h1>
          <p className="text-text-secondary mt-1">{info.session_title}</p>
          {info.location_name && (
            <p className="text-text-secondary/80 text-sm mt-1 flex items-center justify-center gap-1">
              <MapPin size={12} /> {info.location_name}
            </p>
          )}
        </div>
      )}

      {/* 结果态 */}
      {result && (
        <div
          className={`rounded-lg border p-5 text-center mb-6 ${
            result.kind === "fail"
              ? "bg-red-50 border-red-200 text-red-600"
              : "bg-emerald-50 border-emerald-200 text-emerald-600"
          }`}
        >
          {result.kind === "fail" ? (
            <XCircle size={40} className="mx-auto mb-2" />
          ) : (
            <CheckCircle2 size={40} className="mx-auto mb-2" />
          )}
          <p className="font-medium">{result.text}</p>
          {result.kind !== "fail" && info && (
            <Link
              to={`/student/courses/${info.course_id}`}
              className="inline-block mt-3 text-sm underline"
            >
              查看课程与考试
            </Link>
          )}
        </div>
      )}

      {/* 未开始 / 已结束 */}
      {(state === "upcoming" || state === "closed") && !result && (
        <div className="rounded-lg border border-border bg-bg-base p-6 text-center">
          <Clock size={36} className="text-text-secondary mx-auto mb-3" />
          <p className="text-text-secondary">{STATE_LABEL[state]}</p>
          {state === "closed" && (
            <p className="text-xs text-text-secondary/70 mt-2">如未签到，请联系管理员补签</p>
          )}
        </div>
      )}

      {/* 签到进行中 */}
      {state === "open" && !result && (
        <div className="rounded-lg border border-border bg-bg-base p-6 text-center">
          <p className="text-text-secondary mb-4">点击下方按钮，确认完成本场次签到</p>
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full bg-primary text-white py-3.5 rounded-md text-base font-medium hover:bg-primary-light transition-colors disabled:opacity-50"
          >
            {submitting ? "签到中..." : "确认签到"}
          </button>
        </div>
      )}

      <p className="text-center text-xs text-text-secondary/60 mt-6">
        使用本人手机浏览器打开本页完成签到；无需安装任何应用
      </p>
    </div>
  );
}
