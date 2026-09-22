/**
 * 扫码输工号签到 — 落地页（公开、无登录守卫）
 *
 * 适用场景：HTTP 部署、企业微信 OAuth 不可用、学员用任意扫码 App。
 * 投屏页二维码编码 `${FRONTEND_URL}/learning-platform/checkin/{sessionId}`，
 * 学员扫码后输入工号 + 姓名 → 一键签到。
 *
 * 设计要点：
 * - 完全裸页面（无布局、无登录守卫），加载即用。
 * - 输入做基础防抖 + 限频提示；后端按 session+IP 做最终限频。
 * - 失败信息一律统一为「工号或姓名不正确」，避免泄露账号存在性。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, MapPin, Clock, AlertTriangle } from "lucide-react";

interface SessionInfo {
  session_id: string;
  session_title: string;
  course_title: string;
  location_name: string | null;
  start_time: string;
  end_time: string;
  state: "upcoming" | "open" | "closed";
}

type Phase =
  | { kind: "loading" }
  | { kind: "form"; info: SessionInfo }
  | { kind: "submitting"; info: SessionInfo; employee_id: string; name: string }
  | { kind: "success"; info: SessionInfo; status: string; message: string; user_name: string }
  | { kind: "error"; info: SessionInfo; message: string };

const API_BASE = (() => {
  // 与 lib/api.ts 同步：构建时可被 VITE_API_BASE 覆盖。
  // 这里直接走相对路径：扫码页与 API 部署在同一域名。
  return "/api/learning-platform";
})();

async function fetchInfo(sessionId: string): Promise<SessionInfo> {
  const res = await fetch(
    `${API_BASE}/student/checkin/by-credential/info?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `加载失败 (${res.status})`);
  }
  return res.json();
}

async function submitCheckIn(
  sessionId: string,
  employee_id: string,
  name: string,
): Promise<{ ok: boolean; status: string; message: string; user_name?: string }> {
  const res = await fetch(
    `${API_BASE}/student/checkin/by-credential?session_id=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id, name }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.detail || `签到失败 (${res.status})`);
  }
  return body;
}

export default function PublicCheckIn() {
  const { sessionId = "" } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [employeeId, setEmployeeId] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await fetchInfo(sessionId);
        if (alive) setPhase({ kind: "form", info });
      } catch (e) {
        if (alive)
          setPhase({
            kind: "error",
            info: {
              session_id: sessionId,
              session_title: "—",
              course_title: "—",
              location_name: null,
              start_time: "",
              end_time: "",
              state: "closed",
            },
            message: e instanceof Error ? e.message : "加载失败",
          });
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase.kind !== "form") return;
    const emp = employeeId.trim();
    const nm = name.trim();
    if (!emp || !nm) return;
    setPhase({ kind: "submitting", info: phase.info, employee_id: emp, name: nm });
    try {
      const r = await submitCheckIn(sessionId, emp, nm);
      setPhase({
        kind: "success",
        info: phase.info,
        status: r.status,
        message: r.message,
        user_name: nm,
      });
    } catch (err) {
      setPhase({
        kind: "form",
        info: phase.info,
      });
      // 把错误透出但不切换 phase.kind（仍保留在 form）
      alert(err instanceof Error ? err.message : "签到失败");
    }
  };

  return (
    <div className="min-h-screen bg-bg-layout flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
        <Header phase={phase} />

        {phase.kind === "loading" && (
          <div className="p-10 flex items-center justify-center gap-2 text-text-secondary">
            <Loader2 className="animate-spin" size={18} />
            加载中...
          </div>
        )}

        {phase.kind === "error" && (
          <div className="p-8 text-center">
            <XCircle className="mx-auto text-red-500 mb-3" size={42} />
            <p className="text-base text-text-base">{phase.message}</p>
          </div>
        )}

        {phase.kind === "form" && (
          <FormView
            info={phase.info}
            employeeId={employeeId}
            name={name}
            setEmployeeId={setEmployeeId}
            setName={setName}
            onSubmit={onSubmit}
          />
        )}

        {phase.kind === "submitting" && (
          <div className="p-10 flex items-center justify-center gap-2 text-text-secondary">
            <Loader2 className="animate-spin" size={18} />
            正在签到...
          </div>
        )}

        {phase.kind === "success" && (
          <SuccessView
            info={phase.info}
            status={phase.status}
            message={phase.message}
            userName={phase.user_name}
          />
        )}
      </div>
      <p className="text-xs text-text-secondary mt-6">海创光电学习平台 · 线下签到</p>
    </div>
  );
}

function Header({ phase }: { phase: Phase }) {
  const info = phase.kind === "loading" ? null : phase.info;
  return (
    <div className="px-6 py-4 border-b border-border bg-bg-layout/40">
      <div className="text-sm text-text-secondary">线下面授签到</div>
      <div className="text-lg font-semibold text-text-base truncate">
        {info ? info.course_title : "海创光电学习平台"}
      </div>
      {info && (
        <div className="text-xs text-text-secondary truncate">
          {info.session_title}
          {info.location_name ? ` · ${info.location_name}` : ""}
        </div>
      )}
    </div>
  );
}

function FormView(props: {
  info: SessionInfo;
  employeeId: string;
  name: string;
  setEmployeeId: (v: string) => void;
  setName: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { info, employeeId, name, setEmployeeId, setName, onSubmit } = props;
  const open = info.state === "open";
  const disabled = !open || !employeeId.trim() || !name.trim();

  return (
    <form onSubmit={onSubmit} className="p-6 space-y-4">
      <SessionMeta info={info} />

      {!open && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {info.state === "upcoming"
              ? "本场签到尚未开始，请等待管理员宣布。"
              : "本场签到已截止，如有疑问请联系管理员补签。"}
          </span>
        </div>
      )}

      <label className="block">
        <span className="text-sm text-text-secondary">工号</span>
        <input
          autoFocus
          inputMode="text"
          autoComplete="off"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          disabled={!open}
          placeholder=""
          className="mt-1 w-full px-3 py-3 rounded-lg border border-border text-base bg-white disabled:bg-bg-layout"
        />
      </label>
      <label className="block">
        <span className="text-sm text-text-secondary">姓名</span>
        <input
          inputMode="text"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!open}
          placeholder=""
          className="mt-1 w-full px-3 py-3 rounded-lg border border-border text-base bg-white disabled:bg-bg-layout"
        />
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="w-full py-3 rounded-lg bg-primary text-white font-medium text-base disabled:opacity-50"
      >
        确认签到
      </button>
    </form>
  );
}

function SuccessView(props: {
  info: SessionInfo;
  status: string;
  message: string;
  userName: string;
}) {
  return (
    <div className="p-8 text-center">
      <CheckCircle2 className="mx-auto text-green-500 mb-3" size={56} />
      <div className="text-xl font-semibold text-text-base">{props.message}</div>
      <div className="text-sm text-text-secondary mt-1">
        {props.userName} · {props.info.course_title}
      </div>
      <SessionMeta info={props.info} />
    </div>
  );
}

function formatTime(iso: string) {
  return iso.replace("T", " ");
}

function SessionMeta({ info }: { info: SessionInfo }) {
  return (
    <div className="text-xs text-text-secondary space-y-1">
      <div className="flex items-center gap-1.5">
        <Clock size={12} />
        {formatTime(info.start_time)} ~ {formatTime(info.end_time)}
      </div>
      {info.location_name && (
        <div className="flex items-center gap-1.5">
          <MapPin size={12} />
          {info.location_name}
        </div>
      )}
    </div>
  );
}