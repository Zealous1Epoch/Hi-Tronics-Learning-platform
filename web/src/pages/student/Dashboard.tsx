import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface CourseItem {
  id: string; title: string; description: string | null;
  cover_image: string | null; video_count: number; status: string;
}

interface CourseProgress {
  video_progress: Record<string, { watched_seconds: number; total_seconds: number; completed: boolean }>;
  completed_count: number;
  total_count: number;
}

export default function StudentDashboard() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, CourseProgress>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in_progress" | "done">("all");

  useEffect(() => {
    api<CourseItem[]>("/student/courses").then(async (data) => {
      setCourses(data);
      // 获取每门课的进度
      const progressResults: Record<string, CourseProgress> = {};
      await Promise.all(
        data.map(async (c) => {
          try {
            progressResults[c.id] = await api<CourseProgress>(`/student/progress/${c.id}`);
          } catch {
            progressResults[c.id] = { video_progress: {}, completed_count: 0, total_count: c.video_count };
          }
        })
      );
      setProgressMap(progressResults);
      setLoading(false);
    });
  }, []);

  const filteredCourses = courses.filter((c) => {
    const progress = progressMap[c.id];
    if (tab === "in_progress") {
      return progress && progress.completed_count > 0 && progress.completed_count < progress.total_count;
    }
    if (tab === "done") {
      return progress && progress.total_count > 0 && progress.completed_count >= progress.total_count;
    }
    return true;
  });

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">我的课程</h2>
      <div className="flex gap-3 mb-6">
        {[
          { key: "all", label: "全部" },
          { key: "in_progress", label: "进行中" },
          { key: "done", label: "已完成" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 rounded-md text-sm ${
              tab === t.key
                ? "bg-primary text-white"
                : "border border-border text-text-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-text-secondary">加载中...</p>
      ) : filteredCourses.length === 0 ? (
        <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
          {tab === "done" ? "暂无已完成的课程" : tab === "in_progress" ? "暂无进行中的课程" : "暂无课程，请联系管理员分配"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCourses.map((c) => {
            const progress = progressMap[c.id];
            const pct = progress && progress.total_count > 0
              ? Math.round((progress.completed_count / progress.total_count) * 100)
              : 0;
            const isDone = progress && progress.total_count > 0 && pct >= 100;

            return (
              <Link
                key={c.id}
                to={`/student/courses/${c.id}`}
                className="bg-bg-base rounded-lg border border-border hover:shadow-md transition-shadow p-4"
              >
                <h3 className="font-bold text-sm mb-2">{c.title}</h3>
                {c.description && (
                  <p className="text-xs text-text-secondary mb-3 line-clamp-2">{c.description}</p>
                )}
                {/* 进度条 */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                    <span>{c.video_count} 个视频</span>
                    {progress && (
                      <span className={isDone ? "text-green-600" : "text-primary"}>
                        {progress.completed_count}/{progress.total_count} 完成
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-bg-layout rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${isDone ? "bg-green-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="text-xs text-primary">
                  {isDone ? "已完成" : pct > 0 ? "继续学习" : "开始学习"}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}