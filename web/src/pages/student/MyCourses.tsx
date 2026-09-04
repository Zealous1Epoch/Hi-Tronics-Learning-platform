import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface CourseWithProgress {
  id: string; title: string; description: string | null;
  cover_image: string | null; category_id: string | null;
  video_count: number; status: string;
  completed_count: number; total_count: number; exam_passed: boolean;
}

interface CategoryNode {
  id: string; name: string; parent_id: string | null;
  sort_order: number; children: CategoryNode[];
}

function flattenCategories(
  nodes: CategoryNode[],
  depth: number = 0,
  result: { id: string; name: string; depth: number }[] = []
) {
  for (const n of nodes) {
    result.push({ id: n.id, name: n.name, depth });
    if (n.children) flattenCategories(n.children, depth + 1, result);
  }
  return result;
}

export default function MyCourses() {
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in_progress" | "done">("all");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    Promise.all([
      api<CourseWithProgress[]>("/student/courses-with-progress"),
      api<CategoryNode[]>("/question-categories"),
    ])
      .then(([courseData, catData]) => {
        if (mountedRef.current) {
          setCourses(courseData);
          const flat = flattenCategories(catData);
          setCategories(flat.map((c) => ({ id: c.id, name: c.name })));
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  // 按状态过滤
  const filteredCourses = courses.filter((c) => {
    if (tab === "in_progress") {
      const hasProgress = c.completed_count > 0 || c.exam_passed;
      const isComplete = (c.total_count > 0 && c.completed_count >= c.total_count) && c.exam_passed;
      return hasProgress && !isComplete;
    }
    if (tab === "done") {
      return (c.total_count > 0 && c.completed_count >= c.total_count) && c.exam_passed;
    }
    return true;
  });

  // 按分类分组
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const grouped: Record<string, CourseWithProgress[]> = {};
  const uncategorized: CourseWithProgress[] = [];

  for (const c of filteredCourses) {
    if (c.category_id && catMap.has(c.category_id)) {
      const catName = catMap.get(c.category_id)!;
      if (!grouped[catName]) grouped[catName] = [];
      grouped[catName].push(c);
    } else {
      uncategorized.push(c);
    }
  }

  // 按分类排序（保持分类列表顺序）
  const sortedGroupNames = categories
    .map((c) => c.name)
    .filter((name) => grouped[name]);

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">我的课程</h2>

      {/* 状态标签 */}
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
        <div className="space-y-8">
          {/* 有分类的课程 */}
          {sortedGroupNames.map((catName) => (
            <div key={catName}>
              <h3 className="text-base font-bold text-primary mb-3 border-b border-border pb-2">
                {catName}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {grouped[catName].map((c) => (
                  <CourseCard key={c.id} course={c} />
                ))}
              </div>
            </div>
          ))}

          {/* 未分类 */}
          {uncategorized.length > 0 && (
            <div>
              <h3 className="text-base font-bold text-text-secondary mb-3 border-b border-border pb-2">
                未分类
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {uncategorized.map((c) => (
                  <CourseCard key={c.id} course={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CourseCard({ course }: { course: CourseWithProgress }) {
  const isDone = (course.total_count > 0 && course.completed_count >= course.total_count) && course.exam_passed;
  const pct = isDone ? 100 : (course.total_count > 0
    ? Math.round((course.completed_count / course.total_count) * 100)
    : 0);

  return (
    <Link
      to={`/student/courses/${course.id}`}
      className="bg-bg-base rounded-lg border border-border hover:shadow-md transition-shadow p-4 block"
    >
      <h3 className="font-bold text-sm mb-2">{course.title}</h3>
      {course.description && (
        <p className="text-xs text-text-secondary mb-3 line-clamp-2">{course.description}</p>
      )}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
          <span>{course.total_count} 个视频</span>
          <span className="text-primary">
            {course.exam_passed && course.total_count === 0
              ? "考试已通过"
              : `${course.completed_count}/${course.total_count} 完成`}
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
}