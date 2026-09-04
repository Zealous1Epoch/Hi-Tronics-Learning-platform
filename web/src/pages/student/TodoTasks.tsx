import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

// ── 类型定义 ──

interface OverviewTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  completed: boolean;
  overdue_days: number;
  remaining_days: number;
}

interface ActiveCourse {
  id: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  completed_count: number;
  total_count: number;
  exam_passed: boolean;
}

interface OverviewResponse {
  overdue_tasks: OverviewTask[];
  upcoming_tasks: OverviewTask[];
  active_courses: ActiveCourse[];
}

// ── 个人任务卡片 ──

function TaskCard({
  task,
  onToggle,
  onDelete,
  showOverdue,
}: {
  task: OverviewTask;
  onToggle: () => void;
  onDelete: () => void;
  showOverdue: boolean;
}) {
  const label = showOverdue
    ? `已过期 ${task.overdue_days}天`
    : `剩余 ${task.remaining_days}天`;
  const colorClass = showOverdue
    ? "text-red-500"
    : "text-orange-500";

  return (
    <div className="border border-border rounded-lg p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input
            type="checkbox"
            checked={task.completed}
            onChange={onToggle}
            className="w-4 h-4 rounded border-border accent-primary cursor-pointer shrink-0"
          />
          <span className="text-sm text-text-base truncate">{task.title}</span>
        </div>
        <button
          onClick={onDelete}
          className="text-xs text-red-400 opacity-0 hover:opacity-100 transition-opacity shrink-0"
        >
          删除
        </button>
      </div>
      <div className="ml-6 mt-1 flex items-center gap-2 text-xs">
        <span className={`font-medium ${colorClass}`}>{label}</span>
        <span className="text-text-secondary">| 截止: {task.due_date}</span>
      </div>
    </div>
  );
}

// ── 课程卡片 ──

function CourseCard({ course }: { course: ActiveCourse }) {
  const pct =
    course.total_count > 0
      ? Math.round((course.completed_count / course.total_count) * 100)
      : 0;

  return (
    <Link
      to={`/student/courses/${course.id}`}
      className="border border-primary/30 rounded-lg p-3 hover:shadow-sm transition-shadow block bg-primary/[0.02]"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs text-primary font-bold px-1.5 py-0.5 bg-primary/10 rounded">
          课程
        </span>
        <span className="text-sm font-medium text-text-base truncate">
          {course.title}
        </span>
      </div>
      {course.start_date && course.end_date && (
        <p className="text-xs text-text-secondary mb-2">
          {course.start_date} ~ {course.end_date}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-bg-layout rounded-full h-2 border border-border">
          <div
            className="h-2 rounded-full transition-all bg-primary"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-primary shrink-0">进度：{pct}%</span>
      </div>
    </Link>
  );
}

// ── 组区域 ──

function SectionBlock({
  title,
  titleColor,
  children,
}: {
  title: string;
  titleColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-base rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border">
        <span className={`text-sm font-bold ${titleColor || "text-primary"}`}>
          {title}
        </span>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

// ── 主页面 ──

export default function TodoTasks() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await api<OverviewResponse>("/student/tasks/overview");
      if (mountedRef.current) {
        setData(res);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  const handleToggle = async (taskId: string, completed: boolean) => {
    try {
      await api(`/student/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({ completed: !completed }),
      });
      fetchData();
    } catch (e) {
      console.error("更新任务失败", e);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await api(`/student/tasks/${taskId}`, { method: "DELETE" });
      fetchData();
    } catch (e) {
      console.error("删除任务失败", e);
    }
  };

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold text-primary mb-4">代办任务</h2>
        <p className="text-sm text-text-secondary">加载中...</p>
      </div>
    );
  }

  const overdueTasks = data?.overdue_tasks || [];
  const upcomingTasks = data?.upcoming_tasks || [];
  const activeCourses = data?.active_courses || [];
  const hasAny =
    overdueTasks.length > 0 || upcomingTasks.length > 0 || activeCourses.length > 0;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">代办任务</h2>

      {!hasAny ? (
        <div className="bg-bg-base rounded-lg border border-border p-12 text-center">
          <p className="text-text-secondary">暂无待办任务，可以完全放松一下！</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 已过期 */}
          {overdueTasks.length > 0 && (
            <SectionBlock title="已过期" titleColor="text-red-500">
              {overdueTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  showOverdue
                  onToggle={() => handleToggle(t.id, t.completed)}
                  onDelete={() => handleDelete(t.id)}
                />
              ))}
            </SectionBlock>
          )}

          {/* 即将到期 */}
          {upcomingTasks.length > 0 && (
            <SectionBlock title="即将到期" titleColor="text-orange-500">
              {upcomingTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  showOverdue={false}
                  onToggle={() => handleToggle(t.id, t.completed)}
                  onDelete={() => handleDelete(t.id)}
                />
              ))}
            </SectionBlock>
          )}

          {/* 进行中课程 */}
          {activeCourses.length > 0 && (
            <SectionBlock title="进行中课程">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {activeCourses.map((c) => (
                  <CourseCard key={c.id} course={c} />
                ))}
              </div>
            </SectionBlock>
          )}
        </div>
      )}
    </div>
  );
}