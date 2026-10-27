import { useNavigate } from "react-router-dom";
import { CalendarCheck, MapPin, RefreshCw } from "lucide-react";

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
  // 历史字段保留（响应兼容）；卡片由宿主按 required_count>0 决定是否渲染
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
 * 展示本场课程所有签到场次与个人签到状态。「签到码」签到已废除（2026-10-27），
 * 学员统一扫现场投屏二维码 → 输入工号+姓名签到；卡片上的「去签到」按钮直达
 * 同一个扫码签到落地页（同设备无需换手机扫码）。
 */
export default function StudentCheckInCard({
  attendance,
  onChanged,
}: {
  attendance: MyAttendance;
  onChanged: () => void;
}) {
  const navigate = useNavigate();

  const effective = attendance.sessions.filter((s) => s.checked_in && s.status !== "revoked").length;

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
          <button onClick={onChanged} className="text-primary hover:underline flex items-center gap-0.5">
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

                {/* 签到操作：扫现场投屏二维码（或直接进入扫码签到页）输工号姓名签到 */}
                {!effectiveCheckIn && s.state === "open" && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/checkin/${s.id}`)}
                      className="bg-primary text-white rounded-md px-4 py-1.5 text-xs hover:bg-primary-light"
                    >
                      去签到
                    </button>
                    <span className="text-xs text-text-secondary">或用手机扫现场投屏二维码签到</span>
                  </div>
                )}
                {!effectiveCheckIn && s.state === "upcoming" && (
                  <p className="text-xs text-text-secondary/60 mt-1.5">签到尚未开始，开始后可扫码签到</p>
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
