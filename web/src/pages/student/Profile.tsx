import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface ExamHistory {
  exam_id: string; exam_title: string; score: number;
  passed: boolean; attempt_number: number; submitted_at: string;
}
interface StudentProfile {
  assigned_courses: number; completed_courses: number;
  total_videos: number; completed_videos: number;
  total_watched_seconds: number; exam_history: ExamHistory[];
}

export default function StudentProfile() {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<StudentProfile>("/student/profile").then((data) => {
      setProfile(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!profile) return <p className="text-text-secondary">数据加载失败</p>;

  const hours = Math.floor(profile.total_watched_seconds / 3600);
  const minutes = Math.floor((profile.total_watched_seconds % 3600) / 60);
  const videoPct = profile.total_videos > 0
    ? Math.round((profile.completed_videos / profile.total_videos) * 100)
    : 0;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">学习档案</h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <p className="text-2xl font-bold text-primary">{profile.assigned_courses}</p>
          <p className="text-xs text-text-secondary mt-1">已分配课程</p>
        </div>
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <p className="text-2xl font-bold text-green-600">{profile.completed_courses}</p>
          <p className="text-xs text-text-secondary mt-1">已完成课程</p>
        </div>
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <p className="text-2xl font-bold text-primary">{profile.completed_videos}/{profile.total_videos}</p>
          <div className="w-full bg-bg-layout rounded-full h-1.5 mt-2">
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${videoPct}%` }} />
          </div>
          <p className="text-xs text-text-secondary mt-1">视频完成率 {videoPct}%</p>
        </div>
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <p className="text-2xl font-bold text-primary">
            {hours > 0 ? `${hours}时` : ""}{minutes}分
          </p>
          <p className="text-xs text-text-secondary mt-1">累计学习时长</p>
        </div>
      </div>

      {/* 考试记录 */}
      <div className="bg-bg-base rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border font-bold text-sm">考试记录</div>
        {profile.exam_history.length === 0 ? (
          <div className="p-8 text-center text-text-secondary text-sm">暂无考试记录</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-bg-layout/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-text-secondary font-normal">考试名称</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-normal">得分</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-normal">结果</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-normal">次数</th>
                <th className="text-right px-4 py-2.5 text-text-secondary font-normal">交卷时间</th>
              </tr>
            </thead>
            <tbody>
              {profile.exam_history.map((r, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-bg-layout/30">
                  <td className="px-4 py-2.5">{r.exam_title}</td>
                  <td className="px-4 py-2.5">{r.score}分</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded ${r.passed ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {r.passed ? "通过" : "未通过"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">第{r.attempt_number}次</td>
                  <td className="px-4 py-2.5 text-right text-text-secondary">
                    {new Date(r.submitted_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}