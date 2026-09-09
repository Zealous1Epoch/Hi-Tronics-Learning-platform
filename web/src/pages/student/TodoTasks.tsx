import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

// ── 类型定义 ──

interface ActiveCourse {
  id: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  completed_count: number;
  total_count: number;
  exam_passed: boolean;
  has_exam: boolean;
}

interface OverviewResponse {
  active_courses: ActiveCourse[];
  upcoming_expiry_courses: ActiveCourse[];
}

// ── 课程卡片 ──

function CourseCard({ course }: { course: ActiveCourse }) {
  const videoPct = course.has_exam
    ? (course.total_count > 0 ? Math.round((course.completed_count / course.total_count) * 80) : 0)
    : (course.total_count > 0 ? Math.round((course.completed_count / course.total_count) * 100) : 0);
  const examPct = course.has_exam && course.exam_passed ? 20 : 0;
  const totalPct = videoPct + examPct;

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
        {course.has_exam ? (
          <div className="flex flex-1 bg-bg-layout rounded-full h-2 border border-border overflow-hidden">
            <div className="bg-primary transition-all" style={{ width: `${videoPct}%` }} />
            {examPct > 0 && <div className="bg-[#4CAF50] transition-all" style={{ width: `${examPct}%` }} />}
          </div>
        ) : (
          <div className="flex-1 bg-bg-layout rounded-full h-2 border border-border">
            <div className="h-2 rounded-full transition-all bg-primary" style={{ width: `${totalPct}%` }} />
          </div>
        )}
        <span className="text-xs text-primary shrink-0">进度：{totalPct}%</span>
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
    <div className="bg-bg-base rounded-lg border border-border flex flex-col">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <span className={`text-sm font-bold ${titleColor || "text-primary"}`}>
          {title}
        </span>
      </div>
      <div className="p-3 overflow-y-auto h-[66vh] space-y-2">
        {children}
      </div>
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

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold text-primary mb-4">代办任务</h2>
        <p className="text-sm text-text-secondary">加载中...</p>
      </div>
    );
  }

  const activeCourses = data?.active_courses || [];
  const upcomingExpiryCourses = data?.upcoming_expiry_courses || [];

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">代办任务</h2>

      <div className="grid grid-cols-2 gap-4">
        {/* 进行中课程（左）—— 大于3天到期 */}
        <SectionBlock title="进行中课程">
          {activeCourses.length > 0 ? (
            <div className="flex flex-col gap-2">
              {activeCourses.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary text-center py-4">暂无进行中的课程</p>
          )}
        </SectionBlock>

        {/* 即将到期（右）—— 3天内到期 */}
        <SectionBlock title="即将到期" titleColor="text-orange-500">
          {upcomingExpiryCourses.length > 0 ? (
            <div className="flex flex-col gap-2">
              {upcomingExpiryCourses.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary text-center py-4">暂无即将到期的课程</p>
          )}
        </SectionBlock>
      </div>
    </div>
  );
}