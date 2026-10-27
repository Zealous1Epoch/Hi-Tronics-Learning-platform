import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../lib/api";

interface ProjectorCode {
  session_id: string;
  session_title: string;
  course_title: string;
  location_name: string | null;
  server_time: string;
  state: "upcoming" | "open" | "closed";
  checked_in_count: number;
  expected_count: number;
  checkin_url: string;
}

/**
 * 投屏二维码页（投影仪/大屏用）。
 *
 * 设计要点：
 * - 签到码展示已废除（2026-10-27）：大屏只放二维码，学员扫码后输入工号+姓名签到。
 * - 每 5 秒轮询 `/attendance/sessions/{id}/code`（只读接口）刷新签到人数与状态。
 */
export default function AttendanceBoard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectorCode | null>(null);
  const [error, setError] = useState("");
  // 扫码落地页链接：由后端根据 FRONTEND_URL 生成，确保手机可访问
  const checkInUrl = data?.checkin_url ?? `${window.location.origin}/learning-platform/checkin/${sessionId}`;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api<ProjectorCode>(`/attendance/sessions/${sessionId}/code`);
        if (alive) {
          setData(res);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      }
    };
    load();
    const poll = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [sessionId]);

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
            <p className="text-xl text-text-secondary">请等管理员宣布开始后再扫码签到</p>
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
            <p className="text-2xl text-text-secondary mb-8">
              请学员用手机扫码，输入<strong className="text-primary">工号+姓名</strong>签到
            </p>
            {/* 扫码输工号签到（HTTP 即可用，无须企微/无登录） */}
            <div className="flex flex-col items-center">
              <div className="bg-white p-4 rounded-2xl border border-border">
                <QRCodeSVG value={checkInUrl} size={360} level="M" marginSize={0} />
              </div>
              <p className="text-base text-text-secondary mt-4">微信扫一扫 · 输入工号姓名即可签到</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
