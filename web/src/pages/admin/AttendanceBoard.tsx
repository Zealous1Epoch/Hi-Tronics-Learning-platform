import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../lib/api";
import { BASE_URL } from "../../lib/api";

interface ProjectorCode {
  session_id: string;
  session_title: string;
  course_title: string;
  location_name: string | null;
  code: string;
  rotate_seconds: number;
  expires_in: number;
  server_time: string;
  state: "upcoming" | "open" | "closed";
  checked_in_count: number;
  expected_count: number;
}

/**
 * 投屏签到码页（投影仪/大屏用）。
 *
 * 设计要点：
 * - 每秒轮询 `/attendance/sessions/{id}/code`，取当前时间槽的码与剩余秒数。
 *   该接口只读不写，因此可以高频轮询而不产生数据库写入。
 * - 剩余时间用进度条可视化，学员能直观看到「还剩几秒」。
 * - 签到人数实时刷新，方便现场掌握进度。
 */
export default function AttendanceBoard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectorCode | null>(null);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  // 扫码落地页链接：HTTP 环境即可用，不依赖企微 OAuth。
  // 学员用任意扫码 App 打开 → 输入工号+姓名 → 签到。
  const checkInUrl = `${window.location.origin}${BASE_URL}checkin/${sessionId}`;
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 每秒拉取一次当前码
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api<ProjectorCode>(`/attendance/sessions/${sessionId}/code`);
        if (alive) {
          setData(res);
          setSecondsLeft(res.expires_in);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      }
    };
    load();
    const poll = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [sessionId]);

  // 本地秒级倒数，避免等待网络造成的跳动
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={() => navigate("/admin/courses")} className="text-primary hover:underline">
            返回课程管理
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <p className="text-text-secondary">加载中...</p>
      </div>
    );
  }

  const rotate = Math.max(data.rotate_seconds, 1);
  const progress = Math.max(0, Math.min(1, secondsLeft / rotate));

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* 顶部信息条 */}
      <div className="flex items-center justify-between px-10 py-5 border-b border-border">
        <div>
          <div className="text-2xl font-bold text-primary">{data.course_title}</div>
          <div className="text-base text-text-secondary mt-1">
            {data.session_title}
            {data.location_name ? ` · ${data.location_name}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-3xl font-bold text-primary">
              {data.checked_in_count}
              <span className="text-lg text-text-secondary font-normal"> / {data.expected_count}</span>
            </div>
            <div className="text-sm text-text-secondary">已签到人数</div>
          </div>
          <button
            onClick={() => window.close()}
            className="text-text-secondary hover:text-text-base p-2"
            title="关闭投屏页"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex-1 flex flex-col items-center justify-center px-10">
        {data.state === "upcoming" && (
          <>
            <p className="text-4xl font-bold text-primary mb-4">签到尚未开始</p>
            <p className="text-xl text-text-secondary">请等管理员宣布开始后再输入签到码</p>
          </>
        )}

        {data.state === "closed" && (
          <>
            <p className="text-4xl font-bold text-amber-600 mb-4">本场签到已结束</p>
            <p className="text-xl text-text-secondary">未签到的同学请联系管理员补签</p>
          </>
        )}

        {data.state === "open" && (
          <>
            <p className="text-xl text-text-secondary mb-6">
              请学员用手机扫码，输入<strong className="text-primary">工号+姓名</strong>签到；
              或登录平台输入下方签到码
            </p>
            <div className="flex items-center justify-center gap-14">
              {/* 扫码输工号签到（HTTP 即可用，无须企微/无登录） */}
              <div className="flex flex-col items-center">
                <div className="bg-white p-3 rounded-xl border border-border">
                  <QRCodeSVG value={checkInUrl} size={240} level="M" marginSize={0} />
                </div>
                <p className="text-sm text-text-secondary mt-2.5">扫码输入工号签到</p>
              </div>

              {/* 动态码（已登录学员 / 弱网兜底） */}
              <div className="flex flex-col items-center">
                <div className="text-[150px] leading-none font-bold text-primary tracking-[0.15em] tabular-nums">
                  {data.code}
                </div>
                <div className="w-[360px] mt-4">
                  <div className="h-3 rounded-full bg-bg-layout overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                      style={{
                        width: `${progress * 100}%`,
                        background: progress > 0.35 ? "var(--color-primary)" : "#E24B4A",
                      }}
                    />
                  </div>
                  <p className="text-center text-base text-text-secondary mt-2.5">
                    签到码 {secondsLeft} 秒后自动更换
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="px-10 py-5 border-t border-border text-center text-sm text-text-secondary">
        签到码每 {rotate} 秒自动更换，过期码无效；请提醒学员以屏幕上的最新码为准
      </div>
    </div>
  );
}
