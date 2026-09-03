import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface CourseWithProgress {
  id: string; title: string; description: string | null;
  cover_image: string | null; video_count: number; status: string;
  completed_count: number; total_count: number; exam_passed: boolean;
}

export default function StudentDashboard() {
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in_progress" | "done">("all");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api<CourseWithProgress[]>("/student/courses-with-progress")
      .then((data) => {
        if (mountedRef.current) {
          setCourses(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => { mountedRef.current = false; };
  }, []);

  const filteredCourses = courses.filter((c) => {
    if (tab === "in_progress") {
      const hasProgress = c.completed_count > 0 || c.exam_passed;
      const isComplete = (c.total_count > 0 && c.completed_count >= c.total_count) || c.exam_passed;
      return hasProgress && !isComplete;
    }
    if (tab === "done") {
      return (c.total_count > 0 && c.completed_count >= c.total_count) || c.exam_passed;
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
            const isDone = (c.total_count > 0 && c.completed_count >= c.total_count) || c.exam_passed;
            const pct = isDone ? 100 : (c.total_count > 0
              ? Math.round((c.completed_count / c.total_count) * 100)
              : 0);

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
                    <span>{c.total_count} 个视频</span>
                    <span className="text-primary">
                      {c.exam_passed && c.total_count === 0
                        ? "考试已通过"
                        : `${c.completed_count}/${c.total_count} 完成`}
                    </span>
                  </div>
                  <div className="w-full bg-bg-layout rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all bg-primary"
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