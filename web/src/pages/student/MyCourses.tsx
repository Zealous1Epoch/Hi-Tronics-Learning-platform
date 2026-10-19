import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";

interface CourseWithProgress {
  id: string; title: string; description: string | null;
  cover_image: string | null; category_id: string | null;
  // 历史字段保留（响应兼容）；签到展示按 required_count 判定
  course_type: string;
  require_attendance: boolean;
  video_count: number; status: string;
  /** 课件数（PDF/PPT/HTML——无视频课程的内容同样构成课程） */
  material_count: number;
  start_date: string | null; end_date: string | null;
  completed_count: number; total_count: number; exam_passed: boolean;
  has_exam: boolean;
  // 签到附加项（课程配了签到场次时才有值；required_count>0 即需要签到）
  attended_count?: number;
  required_count?: number;
}

interface TreeNode {
  id: string; name: string; parent_id: string | null;
  sort_order: number; children: TreeNode[];
}

interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}

// 收集选中分类及其所有子分类的 ID
function collectDescendantIds(tree: TreeNode[], selectedId: string): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.id === selectedId || ids.has(n.id)) {
        ids.add(n.id);
        // 收集该节点所有子节点
        const collectChildren = (node: TreeNode) => {
          for (const child of node.children) {
            ids.add(child.id);
            collectChildren(child);
          }
        };
        collectChildren(n);
      } else {
        walk(n.children);
      }
    }
  };
  walk(tree);
  return ids;
}

function TreeSidebar({
  tree,
  expandedIds,
  selectedId,
  onToggleExpand,
  onSelect,
}: {
  tree: TreeNode[];
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string | null) => void;
}) {
  const renderNode = (nodes: TreeNode[], depth: number = 0) =>
    nodes.map((node) => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              isSelected ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              onSelect(node.id);
              if (hasChildren) {
                onToggleExpand(node.id);
              }
            }}
          >
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
                className="p-0.5 shrink-0 text-text-secondary"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && hasChildren && renderNode(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="w-56 shrink-0 pr-3 border-r border-border">
      <div
        onClick={() => onSelect(null)}
        className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium mb-2 ${
          selectedId === null ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-bg-layout"
        }`}
      >
        全部课程
      </div>
      <div className="bg-bg-base rounded-lg border border-border max-h-[calc(100vh-240px)] overflow-y-auto">
        {tree.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">暂无分类</p>
        ) : (
          <div className="py-1">{renderNode(tree)}</div>
        )}
      </div>
    </div>
  );
}

/** 课程是否学完：有视频的看观看数 + 考试通过；
 *  纯课件且无考试的课程不采集阅读进度，不标记为已完成 */
function isCourseDone(c: CourseWithProgress): boolean {
  const videosDone = c.total_count === 0 || c.completed_count >= c.total_count;
  if (c.has_exam && !c.exam_passed) return false;
  return c.total_count > 0 || c.has_exam ? videosDone : false;
}

function CourseCard({ course }: { course: CourseWithProgress }) {
  const videosDone = course.total_count === 0 || course.completed_count >= course.total_count;
  const isDone = isCourseDone(course);
  const needExam = course.has_exam && videosDone && !course.exam_passed;
  const videoPct = course.has_exam
    ? (course.total_count > 0 ? Math.round((course.completed_count / course.total_count) * 80) : 0)
    : (course.total_count > 0 ? Math.round((course.completed_count / course.total_count) * 100) : 0);
  const examPct = course.has_exam && course.exam_passed ? 20 : 0;
  const totalPct = isDone ? 100 : videoPct + examPct;

  return (
    <Link
      to={`/student/courses/${course.id}`}
      className="bg-bg-base rounded-lg border border-border hover:shadow-sm transition-shadow p-3 block"
    >
      <h3 className="font-bold text-xs mb-1">{course.title}</h3>
      {course.description && (
        <p className="text-[11px] text-text-secondary mb-1.5 line-clamp-1">{course.description}</p>
      )}
      <div className="mb-1.5">
        <div className="flex items-center justify-between text-[11px] text-text-secondary mb-0.5">
          <span>
            {course.total_count > 0
              ? `${course.total_count} 个视频`
              : course.material_count > 0
                ? `课件 ${course.material_count} 份`
                : "内容待上传"}
            {(course.required_count ?? 0) > 0 && (
              <span className="ml-2 text-violet-600">
                · 已签到 {course.attended_count ?? 0}/{course.required_count ?? 0} 场
              </span>
            )}
          </span>
          <span className="text-primary">
            {course.total_count === 0
              ? (course.exam_passed ? "考试已通过" : "点开学习")
              : `${course.completed_count}/${course.total_count} 完成`}
          </span>
        </div>
        {course.has_exam ? (
          <div className="flex w-full bg-bg-layout rounded-full h-1 overflow-hidden">
            <div className="bg-primary transition-all" style={{ width: `${videoPct}%` }} />
            {examPct > 0 && <div className="bg-[#4CAF50] transition-all" style={{ width: `${examPct}%` }} />}
          </div>
        ) : (
          <div className="w-full bg-bg-layout rounded-full h-1">
            <div className="h-1 rounded-full transition-all bg-primary" style={{ width: `${totalPct}%` }} />
          </div>
        )}
      </div>
      {course.start_date && course.end_date && (
        <p className="text-[11px] text-text-secondary text-right">{course.start_date} ~ {course.end_date}</p>
      )}
      <div className="text-[11px] text-primary">
        {isDone ? "已完成" : needExam ? "继续考试" : totalPct > 0 ? "继续学习" : "开始学习"}
        <span className="ml-1 text-text-secondary">({totalPct}%)</span>
      </div>
    </Link>
  );
}

export default function MyCourses() {
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in_progress" | "done" | "not_started">("all");
  const mountedRef = useRef(true);

  const fetchData = () => {
    Promise.all([
      api<CourseWithProgress[]>("/student/courses-with-progress"),
      api<TreeNode[]>("/question-categories/tree"),
      api<FlatCategory[]>("/question-categories/flat"),
    ])
      .then(([courseData, treeData, flatData]) => {
        if (mountedRef.current) {
          setCourses(courseData);
          // 过滤树：只保留有课程的分类节点
          const catIdsWithCourses = new Set(
            courseData.map((c) => c.category_id).filter(Boolean) as string[]
          );
          const filterTree = (nodes: TreeNode[]): TreeNode[] =>
            nodes
              .map((n) => ({ ...n, children: filterTree(n.children) }))
              .filter(
                (n) =>
                  catIdsWithCourses.has(n.id) || n.children.length > 0
              );
          setTree(filterTree(treeData));
          setFlatCategories(flatData);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // 按状态过滤（完成口径与卡片一致，走 isCourseDone）
  const filteredByStatus = courses.filter((c) => {
    if (tab === "in_progress") {
      const hasProgress = c.completed_count > 0 || c.exam_passed;
      return hasProgress && !isCourseDone(c);
    }
    if (tab === "done") {
      return isCourseDone(c);
    }
    if (tab === "not_started") {
      return c.completed_count === 0 && !c.exam_passed;
    }
    return true;
  });

  // 按分类过滤
  const categoryIds = selectedId ? collectDescendantIds(tree, selectedId) : null;
  const filteredCourses = categoryIds
    ? filteredByStatus.filter((c) => c.category_id && categoryIds.has(c.category_id))
    : filteredByStatus;

  // 按分类分组（按根节点分类名分组，子分类归入父级）
  const parentMap = new Map(flatCategories.map((c) => [c.id, c.parent_id]));
  const nameMap = new Map(flatCategories.map((c) => [c.id, c.name]));
  const getRootName = (id: string): string => {
    let current = id;
    let parent = parentMap.get(current);
    while (parent) {
      current = parent;
      parent = parentMap.get(current);
    }
    return nameMap.get(current) || "未分类";
  };
  const grouped: Record<string, CourseWithProgress[]> = {};
  const uncategorized: CourseWithProgress[] = [];

  for (const c of filteredCourses) {
    if (c.category_id && nameMap.has(c.category_id)) {
      const rootName = getRootName(c.category_id);
      if (!grouped[rootName]) grouped[rootName] = [];
      grouped[rootName].push(c);
    } else {
      uncategorized.push(c);
    }
  }

  const sortedGroupNames = Object.keys(grouped);

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">我的课程</h2>

      <div className="flex gap-6">
        {/* 左侧分类树 */}
        <TreeSidebar
          tree={tree}
          expandedIds={expandedIds}
          selectedId={selectedId}
          onToggleExpand={toggleExpand}
          onSelect={setSelectedId}
        />

        {/* 右侧课程列表 */}
        <div className="flex-1 min-w-0">
          {/* 状态标签 */}
          <div className="flex gap-3 mb-3">
            {[
              { key: "all", label: "全部" },
              { key: "not_started", label: "未开始" },
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
              {tab === "done" ? "暂无已完成的课程" : tab === "in_progress" ? "暂无进行中的课程" : tab === "not_started" ? "暂无未开始的课程" : "暂无课程，请联系管理员分配"}
            </div>
          ) : (
            <div className="space-y-3">
              {sortedGroupNames.map((catName) => (
                <div key={catName} className="bg-bg-base rounded-lg border border-border p-3">
                  <h3 className="text-sm font-bold text-primary mb-2 border-b border-border pb-1.5">
                    {catName}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {grouped[catName].map((c) => (
                      <CourseCard key={c.id} course={c} />
                    ))}
                  </div>
                </div>
              ))}

              {uncategorized.length > 0 && (
                <div className="bg-bg-base rounded-lg border border-border p-3">
                  <h3 className="text-sm font-bold text-text-secondary mb-2 border-b border-border pb-1.5">
                    未分类
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {uncategorized.map((c) => (
                      <CourseCard key={c.id} course={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}