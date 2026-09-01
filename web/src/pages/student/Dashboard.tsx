import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface CourseItem {
  id: string; title: string; description: string | null;
  cover_image: string | null; video_count: number; status: string;
}

export default function StudentDashboard() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in_progress" | "done">("all");

  useEffect(() => {
    api<CourseItem[]>("/student/courses").then((data) => {
      setCourses(data);
      setLoading(false);
    });
  }, []);

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
      ) : courses.length === 0 ? (
        <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
          暂无课程，请联系管理员分配
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <Link
              key={c.id}
              to={`/student/courses/${c.id}`}
              className="bg-bg-base rounded-lg border border-border hover:shadow-md transition-shadow p-4"
            >
              <h3 className="font-bold text-sm mb-2">{c.title}</h3>
              {c.description && (
                <p className="text-xs text-text-secondary mb-3 line-clamp-2">{c.description}</p>
              )}
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>{c.video_count} 个视频</span>
                <span className="text-primary">开始学习</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}