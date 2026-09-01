import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface CourseProgress {
  course_id: string; course_title: string;
  completed_count: number; total_count: number; progress_pct: number;
}
interface UserProgressItem {
  user_id: string; user_name: string; username: string;
  department: string | null; courses: CourseProgress[];
}
interface CourseItem {
  id: string; title: string;
}

export default function UserProgress() {
  const [progress, setProgress] = useState<UserProgressItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [courseFilter, setCourseFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<UserProgressItem[]>("/admin/progress"),
      api<CourseItem[]>("/courses"),
    ]).then(([progressData, coursesData]) => {
      setProgress(progressData);
      setCourses(coursesData);
      setLoading(false);
    });
  }, []);

  const filteredProgress = courseFilter
    ? progress.map((u) => ({
        ...u,
        courses: u.courses.filter((c) => c.course_id === courseFilter),
      })).filter((u) => u.courses.length > 0)
    : progress;

  // 计算每个学员的总体进度
  const getUserOverallProgress = (user: UserProgressItem) => {
    if (user.courses.length === 0) return 0;
    const totalCompleted = user.courses.reduce((sum, c) => sum + c.completed_count, 0);
    const totalVideos = user.courses.reduce((sum, c) => sum + c.total_count, 0);
    return totalVideos > 0 ? Math.round((totalCompleted / totalVideos) * 100) : 0;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-primary">学员进度</h2>
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">全部课程</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-text-secondary">加载中...</p>
      ) : filteredProgress.length === 0 ? (
        <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
          暂无学习记录
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProgress.map((user) => {
            const overallPct = getUserOverallProgress(user);
            return (
              <div key={user.user_id} className="bg-bg-base rounded-lg border border-border">
                <div className="flex items-center gap-4 px-4 py-3 border-b border-border bg-bg-layout/50">
                  <span className="font-bold text-sm">{user.user_name}</span>
                  <span className="text-xs text-text-secondary">{user.username}</span>
                  {user.department && (
                    <span className="text-xs text-text-secondary">{user.department}</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <div className="w-24 bg-bg-base rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${overallPct >= 100 ? "bg-green-500" : "bg-primary"}`}
                        style={{ width: `${overallPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-text-secondary">{overallPct}%</span>
                  </div>
                </div>
                <div className="px-4 py-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-text-secondary text-xs">
                        <th className="text-left py-1.5 font-normal">课程</th>
                        <th className="text-right py-1.5 font-normal w-24">进度</th>
                        <th className="text-right py-1.5 font-normal w-20">完成率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {user.courses.map((c) => (
                        <tr key={c.course_id} className="border-t border-border/50">
                          <td className="py-1.5">{c.course_title}</td>
                          <td className="py-1.5 text-right text-text-secondary">
                            {c.completed_count}/{c.total_count} 视频
                          </td>
                          <td className="py-1.5 text-right">
                            <span className={c.progress_pct >= 100 ? "text-green-600" : "text-primary"}>
                              {c.progress_pct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}