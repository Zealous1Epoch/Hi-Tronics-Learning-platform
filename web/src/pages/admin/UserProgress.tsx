import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../../lib/api";
import { Search, ChevronRight, ChevronDown } from "lucide-react";

// 部门树
interface DeptNode {
  id: string; name: string; parent_id: string | null;
  children: DeptNode[];
}
interface FlatDept {
  id: string; name: string; parent_id: string | null;
}

// 课程进度概览
interface CourseOverview {
  course_id: string;
  course_title: string;
  video_completed: number;
  video_total: number;
  exam_passed: boolean;
  exam_best_score: number | null;
  exam_attempts: number;
}
interface UserProgressOverview {
  user_id: string;
  user_name: string;
  username: string;
  department: string | null;
  courses: CourseOverview[];
}

// 课程
interface CourseItem {
  id: string; title: string;
}

// 详情
interface VideoDetail {
  video_id: string;
  title: string;
  watched_seconds: number;
  total_seconds: number;
  completed: boolean;
}
interface ExamDetail {
  exam_id: string;
  exam_title: string;
  score: number;
  passed: boolean;
  attempt_number: number;
  submitted_at: string;
}
interface ProgressDetail {
  videos: VideoDetail[];
  exams: ExamDetail[];
}

// 工具函数
function formatSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function UserProgress() {
  // 部门
  const [deptTree, setDeptTree] = useState<DeptNode[]>([]);
  const [flatDepts, setFlatDepts] = useState<FlatDept[]>([]);
  const [expandedDeptIds, setExpandedDeptIds] = useState<Set<string>>(new Set());
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [deptSearch, setDeptSearch] = useState("");

  // 数据
  const [overviewData, setOverviewData] = useState<UserProgressOverview[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [courseFilter, setCourseFilter] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 用户课程展开
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set());

  // 详情展开
  const [expandedKey, setExpandedKey] = useState<string | null>(null); // "userId|courseId"
  const [detailData, setDetailData] = useState<ProgressDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError("");
    Promise.all([
      api<DeptNode[]>("/departments"),
      api<FlatDept[]>("/departments/flat"),
      api<UserProgressOverview[]>("/admin/progress/overview"),
      api<CourseItem[]>("/courses"),
    ]).then(([tree, flat, overview, coursesData]) => {
      setDeptTree(tree);
      setFlatDepts(flat);
      setOverviewData(overview);
      setCourses(coursesData);
      setLoading(false);
    }).catch((err) => {
      console.error("加载学员进度失败", err);
      setError("加载失败，请刷新重试");
      setLoading(false);
    });
  };

  // 初始加载
  useEffect(() => { fetchData(); }, []);

  // 收集部门及其子部门的所有名称
  const deptNameMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    function collect(d: DeptNode): Set<string> {
      const names = new Set<string>([d.name]);
      d.children.forEach((c) => {
        collect(c).forEach((n) => names.add(n));
      });
      map[d.id] = names;
      return names;
    }
    deptTree.forEach((d) => collect(d));
    return map;
  }, [deptTree]);

  // 过滤数据
  const filteredData = useMemo(() => {
    let data = overviewData;

    // 部门过滤
    if (selectedDeptId && deptNameMap[selectedDeptId]) {
      const names = deptNameMap[selectedDeptId];
      data = data.filter((u) => u.department && names.has(u.department));
    }

    // 课程过滤
    if (courseFilter) {
      data = data.map((u) => ({
        ...u,
        courses: u.courses.filter((c) => c.course_id === courseFilter),
      })).filter((u) => u.courses.length > 0);
    }

    // 学员搜索
    if (studentSearch) {
      const lower = studentSearch.toLowerCase();
      data = data.filter(
        (u) =>
          u.user_name.toLowerCase().includes(lower) ||
          u.username.toLowerCase().includes(lower)
      );
    }

    return data;
  }, [overviewData, selectedDeptId, deptNameMap, courseFilter, studentSearch]);

  // 获取用户总体进度
  const getUserOverallPct = (user: UserProgressOverview) => {
    if (user.courses.length === 0) return 0;
    const totalVideos = user.courses.reduce((s, c) => s + c.video_total, 0);
    const completedVideos = user.courses.reduce((s, c) => s + c.video_completed, 0);
    // 考试通过的课程也算完成
    const examPassedCourses = user.courses.filter((c) => c.exam_passed && c.video_total === 0).length;
    return totalVideos > 0
      ? Math.round((completedVideos / totalVideos) * 100)
      : examPassedCourses > 0 ? 100 : 0;
  };

  // 加载详情
  const loadDetail = async (userId: string, courseId: string) => {
    const key = `${userId}|${courseId}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      setDetailData(null);
      return;
    }
    setExpandedKey(key);
    setLoadingDetail(true);
    try {
      const data = await api<ProgressDetail>(`/admin/progress/detail/${userId}/${courseId}`);
      setDetailData(data);
    } catch {
      setDetailData(null);
    }
    setLoadingDetail(false);
  };

  // 部门树搜索过滤
  const filterTree = useCallback((nodes: DeptNode[], term: string): DeptNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    const result: DeptNode[] = [];
    for (const node of nodes) {
      const filteredChildren = filterTree(node.children, term);
      if (node.name.toLowerCase().includes(lower) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
    return result;
  }, []);

  const filteredTree = useMemo(
    () => (deptSearch ? filterTree(deptTree, deptSearch) : deptTree),
    [deptTree, deptSearch, filterTree]
  );

  // 搜索时自动展开，搜索清空时重置展开状态
  useEffect(() => {
    if (!deptSearch) {
      setExpandedDeptIds(new Set());
      return;
    }
    const collectIds = (nodes: DeptNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };
    setExpandedDeptIds(new Set(collectIds(filteredTree)));
  }, [deptSearch, filteredTree]);

  const toggleExpand = (id: string) => {
    setExpandedDeptIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectDept = (nodeId: string) => {
    setSelectedDeptId((prev) => (prev === nodeId ? null : nodeId));
  };

  // 渲染部门树
  const renderTree = (nodes: DeptNode[], depth: number = 0) => {
    return nodes.map((node) => {
      const isExpanded = expandedDeptIds.has(node.id);
      const isSelected = selectedDeptId === node.id;
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              isSelected ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              handleSelectDept(node.id);
              if (hasChildren) toggleExpand(node.id);
            }}
          >
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                className="p-0.5 shrink-0 text-text-secondary"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
            {isSelected && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            )}
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">学员进度</h2>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-2 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => { setError(""); fetchData(); }} className="text-primary hover:underline text-xs">重试</button>
        </div>
      )}

      <div className="flex gap-4">
        {/* 左侧部门树 */}
        <div className="w-56 shrink-0 pr-4 border-r border-border">
          <div
            onClick={() => setSelectedDeptId(null)}
            className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium mb-2 ${
              selectedDeptId === null ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-bg-layout"
            }`}
          >
            全部学员
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="搜索部门..."
              value={deptSearch}
              onChange={(e) => setDeptSearch(e.target.value)}
              className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
            />
          </div>
          <div className="bg-bg-base rounded-lg border border-border max-h-[calc(100vh-220px)] overflow-y-auto">
            {filteredTree.length === 0 ? (
              <p className="p-4 text-sm text-text-secondary text-center">
                {deptSearch ? "无匹配结果" : "暂无部门"}
              </p>
            ) : (
              <div className="py-1">{renderTree(filteredTree)}</div>
            )}
          </div>
          {selectedDeptId && (
            <button
              onClick={() => setSelectedDeptId(null)}
              className="mt-2 w-full text-xs text-text-secondary hover:text-primary"
            >
              清除筛选
            </button>
          )}
        </div>

        {/* 右侧 */}
        <div className="flex-1 min-w-0">
          {/* 顶部筛选栏 */}
          <div className="flex items-center gap-3 mb-4">
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
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                placeholder="搜索学员..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
              />
            </div>
            <button
              onClick={() => {
                const token = localStorage.getItem("token");
                fetch("/api/admin/progress/export", {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                })
                  .then(res => {
                    if (!res.ok) throw new Error("导出失败");
                    return res.blob();
                  })
                  .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "学员进度.xlsx";
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(err => alert(err.message));
              }}
              className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-bg-layout shrink-0"
            >
              导出
            </button>
          </div>

          {/* 学员进度列表 */}
          {loading ? (
            <p className="text-text-secondary">加载中...</p>
          ) : filteredData.length === 0 ? (
            <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
              暂无学习记录
            </div>
          ) : (
            <div className="space-y-3">
              {filteredData.map((user) => {
                const overallPct = getUserOverallPct(user);
                const isUserExpanded = expandedUserIds.has(user.user_id);
                const totalCourses = user.courses.length;
                const completedCourses = user.courses.filter(
                  (c) => (c.video_total > 0 && c.video_completed >= c.video_total) || c.exam_passed
                ).length;

                return (
                  <div key={user.user_id} className="bg-bg-base rounded-lg border border-border">
                    {/* 用户头部 */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="font-bold text-sm">{user.user_name}</span>
                      <span className="text-xs text-text-secondary">{user.username}</span>
                      {user.department && (
                        <span className="text-xs text-text-secondary bg-bg-layout px-1.5 py-0.5 rounded border border-border">
                          {user.department}
                        </span>
                      )}
                      <span className="text-xs text-text-secondary ml-auto">
                        {completedCourses}/{totalCourses} 课程
                      </span>
                      <div className="w-32 bg-bg-layout rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${overallPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-primary font-medium w-10 text-right">{overallPct}%</span>
                      <button
                        onClick={() => {
                          setExpandedUserIds((prev) => {
                            const next = new Set(prev);
                            isUserExpanded ? next.delete(user.user_id) : next.add(user.user_id);
                            return next;
                          });
                        }}
                        className="text-xs text-primary border border-primary rounded px-2 py-0.5 hover:bg-primary/5 shrink-0"
                      >
                        {isUserExpanded ? "收起课程" : "查看课程"}
                      </button>
                    </div>

                    {/* 课程列表（可折叠） */}
                    {isUserExpanded && (
                      <div className="px-4 pb-1 border-t border-border">
                        {user.courses.map((c) => {
                          const isDetailOpen = expandedKey === `${user.user_id}|${c.course_id}`;
                          const pct = c.video_total > 0
                            ? Math.round((c.video_completed / c.video_total) * 100)
                            : c.exam_passed ? 100 : 0;
                          const isDone = (c.video_total > 0 && c.video_completed >= c.video_total) && c.exam_passed;

                          let statusLabel = "";
                          let statusClass = "";
                          if (isDone && c.exam_passed) {
                            statusLabel = "已完成";
                            statusClass = "text-primary";
                          } else if (c.video_completed >= c.video_total) {
                            statusLabel = "视频已完成";
                            statusClass = "text-primary";
                          } else if (c.exam_passed) {
                            statusLabel = "考试已通过";
                            statusClass = "text-primary";
                          } else if (c.video_completed > 0) {
                            statusLabel = "进行中";
                            statusClass = "text-text-secondary";
                          } else {
                            statusLabel = "未开始";
                            statusClass = "text-text-secondary";
                          }

                          return (
                            <div key={c.course_id}>
                              <div className="flex items-center gap-3 py-2 border-t border-border/50">
                                <span className="text-sm flex-1 min-w-0 truncate">{c.course_title}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="w-24 bg-bg-layout rounded-full h-1.5">
                                    <div
                                      className="h-1.5 rounded-full bg-primary"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-primary w-8 text-right">{pct}%</span>
                                </div>
                                <span className={`text-xs shrink-0 w-20 text-right ${statusClass}`}>
                                  {statusLabel}
                                  {c.exam_passed && statusLabel !== "已完成" && statusLabel !== "考试已通过" && (
                                    <span className="text-primary ml-1">+ 考试</span>
                                  )}
                                </span>
                                <button
                                  onClick={() => loadDetail(user.user_id, c.course_id)}
                                  className="text-xs text-primary hover:underline shrink-0"
                                >
                                  {isDetailOpen ? "收起" : "展开详情"}
                                </button>
                              </div>

                              {isDetailOpen && (
                                <div className="bg-bg-layout/30 rounded-md px-4 py-3 mb-2 border border-border/50">
                                  {loadingDetail ? (
                                    <p className="text-xs text-text-secondary">加载中...</p>
                                  ) : detailData ? (
                                    <div className="space-y-3">
                                      {detailData.videos.length > 0 && (
                                        <div>
                                          <h4 className="text-xs font-bold text-text-secondary mb-1.5">视频进度</h4>
                                          <div className="space-y-1">
                                            {detailData.videos.map((v) => (
                                              <div key={v.video_id} className="flex items-center gap-3 text-xs">
                                                <span className="flex-1 truncate">{v.title}</span>
                                                <span className="text-text-secondary shrink-0">
                                                  {formatSeconds(v.watched_seconds)} / {formatSeconds(v.total_seconds)}
                                                </span>
                                                <span className={`shrink-0 w-14 text-right ${
                                                  v.completed ? "text-primary" : v.watched_seconds > 0 ? "text-text-secondary" : "text-text-secondary"
                                                }`}>
                                                  {v.completed ? "100%" : v.total_seconds > 0 ? `${Math.round(v.watched_seconds / v.total_seconds * 100)}%` : "0%"}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {detailData.exams.length > 0 && (
                                        <div>
                                          <h4 className="text-xs font-bold text-text-secondary mb-1.5">考试记录</h4>
                                          <div className="space-y-1">
                                            {detailData.exams.map((ex, i) => (
                                              <div key={i} className="flex items-center gap-3 text-xs">
                                                <span className="text-text-secondary shrink-0">第{ex.attempt_number}次</span>
                                                <span className="font-medium shrink-0">{ex.score}分</span>
                                                <span className={`shrink-0 ${ex.passed ? "text-primary" : "text-red-500"}`}>
                                                  {ex.passed ? "通过" : "未通过"}
                                                </span>
                                                <span className="text-text-secondary truncate">
                                                  {new Date(ex.submitted_at).toLocaleString("zh-CN", {
                                                    year: "numeric", month: "2-digit", day: "2-digit",
                                                    hour: "2-digit", minute: "2-digit",
                                                  })}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {detailData.exams.length === 0 && (
                                        <p className="text-xs text-text-secondary">暂无考试记录</p>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-text-secondary">加载失败</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}