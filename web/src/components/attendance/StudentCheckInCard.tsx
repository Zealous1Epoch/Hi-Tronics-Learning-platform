import { useState } from "react";
import { CalendarCheck, MapPin, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { getDeviceId } from "../../lib/device";

/* ── 类型（与后端 schemas/attendance.py 学员端模型对应） ── */
export interface MySessionState {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location_name: string | null;
  state: "upcoming" | "open" | "closed" | string;
  require_geofence: boolean;
  checked_in: boolean;
  status: string | null; // present / late / manual / revoked
  checked_in_at: string | null;
  remark: string | null;
}

export interface MyAttendance {
  course_id: string;
  // 历史字段保留（响应兼容）；新前端按 require_attendance 判定
  course_type: string;
  require_attendance: boolean;
  sessions: MySessionState[];
  required_count: number;
  attended_count: number;
  satisfied: boolean;
  can_take_exam: boolean;
  blockers: string[];
}

const STATE_LABEL: Record<string, string> = {
  upcoming: "未开始",
  open: "签到中",
  closed: "已结束",
};
const STATE_CLASS: Record<string, string> = {
  upcoming: "bg-bg-layout text-text-secondary",
  open: "bg-emerald-50 text-emerald-600",
  closed: "bg-amber-50 text-amber-600",
};
const STATUS_LABEL: Record<string, string> = {
  present: "已签到",
  late: "迟到",
  manual: "管理员补签",
  revoked: "已撤销",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * 学员端线下课程签到卡片。
 *
 * 展示本场课程所有签到场次与个人签到状态；「签到中」的场次可输入投屏大屏上的
 * 动态签到码完成签到。若场次开启定位校验，会先请求浏览器定位再一并提交。
 */
export default function StudentCheckInCard({
  attendance,
  onChanged,
}: {
  attendance: MyAttendance;
  onChanged: () => void;
}) {
  const [codeOpenId, setCodeOpenId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [locating, setLocating] = useState(false);

  const effective = attendance.sessions.filter((s) => s.checked_in && s.status !== "revoked").length;

  const refresh = () => {
    setMessage(null);
    onChanged();
  };

  const submitCheckIn = async (session: MySessionState) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setMessage({ ok: false, text: "请输入投屏大屏上的签到码" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // 场次要求定位时先取坐标（失败则不带坐标提交，由后端判定并打标）
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (session.require_geofence) {
        setLocating(true);
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 30000,
            });
          });
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch {
          /* 未授权/失败时不携带坐标，后端会按策略拒绝或软放行并打标 */
        } finally {
          setLocating(false);
        }
      }
      const res = await api<{ ok: boolean; status: string; message: string; risk_flags: string[] }>(
        `/student/attendance/${session.id}/checkin`,
        {
          method: "POST",
          body: JSON.stringify({
            code: trimmed,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            device_id: getDeviceId(),
          }),
        },
      );
      setMessage({
        ok: true,
        text:
          `${res.message || "签到成功"}（${STATUS_LABEL[res.status] || res.status}）` +
          (res.risk_flags?.length ? ` · 有异常标记：${res.risk_flags.join("、")}` : ""),
      });
      setCode("");
      setCodeOpenId(null);
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "签到失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-bg-base rounded-lg border border-border p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
          <CalendarCheck size={15} /> 线下签到
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">
            已完成 <span className="text-primary font-medium">{effective}</span> / {attendance.required_count} 场
          </span>
          <button onClick={refresh} className="text-primary hover:underline flex items-center gap-0.5">
            <RefreshCw size={11} /> 刷新
          </button>
        </div>
      </div>

      {/* 进度条 */}
      <div className="w-full bg-bg-layout rounded-full h-1.5 mb-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{
            width: `${attendance.required_count > 0 ? Math.min(100, (effective / attendance.required_count) * 100) : 0}%`,
          }}
        />
      </div>

      {/* 考试解锁提示 */}
      {!attendance.satisfied && attendance.blockers.length > 0 && (
        <div className="bg-amber-50 text-amber-700 text-xs rounded-md px-3 py-2 mb-3">
          {attendance.blockers.map((b, i) => (
            <p key={i}>· {b}</p>
          ))}
        </div>
      )}
      {attendance.satisfied && (
        <div className="bg-emerald-50 text-emerald-600 text-xs rounded-md px-3 py-2 mb-3">
          签到已全部完成，可以参加考试了
        </div>
      )}

      {/* 签到结果提示 */}
      {message && (
        <div
          className={`text-xs rounded-md px-3 py-2 mb-3 ${
            message.ok ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 场次列表 */}
      {attendance.sessions.length === 0 ? (
        <p className="text-xs text-text-secondary py-2 text-center">
          本课程尚未配置签到场次，请联系管理员
        </p>
      ) : (
        <div className="space-y-2">
          {attendance.sessions.map((s) => {
            const effectiveCheckIn = s.checked_in && s.status !== "revoked";
            return (
              <div key={s.id} className="border border-border rounded-md p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{s.title}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {effectiveCheckIn ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">
                        {STATUS_LABEL[s.status || "present"] || "已签到"}
                      </span>
                    ) : (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATE_CLASS[s.state] || ""}`}>
                        {STATE_LABEL[s.state] || s.state}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-text-secondary mt-1 flex items-center flex-wrap gap-x-3 gap-y-0.5">
                  <span>
                    {fmt(s.start_time)} ~ {fmt(s.end_time)}
                  </span>
                  {s.location_name && (
                    <span className="flex items-center gap-0.5">
                      <MapPin size={10} /> {s.location_name}
                    </span>
                  )}
                  {s.require_geofence && <span className="text-text-secondary/60">需定位校验</span>}
                  {effectiveCheckIn && s.checked_in_at && <span>签到于 {fmt(s.checked_in_at)}</span>}
                </div>

                {/* 签到操作 */}
                {!effectiveCheckIn && s.state === "open" && (
                  <div className="mt-2">
                    {codeOpenId === s.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && submitCheckIn(s)}
                          placeholder="输入投屏签到码"
                          maxLength={16}
                          autoFocus
                          className="w-36 border border-border rounded-md px-2.5 py-1.5 text-sm tracking-widest uppercase"
                        />
                        <button
                          onClick={() => submitCheckIn(s)}
                          disabled={busy || locating}
                          className="bg-primary text-white rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          {locating ? "定位中..." : busy ? "提交中..." : "签到"}
                        </button>
                        <button
                          onClick={() => {
                            setCodeOpenId(null);
                            setCode("");
                            setMessage(null);
                          }}
                          className="text-xs text-text-secondary hover:text-text-base"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setCodeOpenId(s.id);
                          setCode("");
                          setMessage(null);
                        }}
                        className="bg-primary text-white rounded-md px-4 py-1.5 text-xs hover:bg-primary-light"
                      >
                        输入签到码签到
                      </button>
                    )}
                  </div>
                )}
                {!effectiveCheckIn && s.state === "upcoming" && (
                  <p className="text-xs text-text-secondary/60 mt-1.5">签到尚未开始，开始后可在此输入签到码</p>
                )}
                {!effectiveCheckIn && s.state === "closed" && (
                  <p className="text-xs text-amber-600 mt-1.5">本场签到已结束，如未签到请联系管理员补签</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
