import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, ArrowRight, Trash2, Clock, BookOpen,
} from "lucide-react";
import { api } from "../../lib/api";
import { Skeleton, EmptyState } from "../../components/ui/Misc";
import { notify } from "../../components/ui/Toast";

// ── 类型 ──

interface CourseWithProgress {
  id: string; title: string; description: string | null;
  cover_image: string | null; category_id: string | null;
  video_count: number; status: string;
  start_date: string | null; end_date: string | null;
  completed_count: number; total_count: number;
  exam_passed: boolean; has_exam: boolean;
}

interface StudentProfile {
  assigned_courses: number; completed_courses: number;
  total_videos: number; completed_videos: number;
  total_watched_seconds: number;
}

interface TaskItem {
  id: string; title: string; due_date: string; completed: boolean;
}

interface DailyPlanCourse {
  id: string; title: string;
  start_date: string | null; end_date: string | null;
  completed_count: number; total_count: number;
  exam_passed: boolean; has_exam: boolean;
}

interface DailyPlan { tasks: TaskItem[]; courses: DailyPlanCourse[]; }

interface NoticeItem {
  id: string; title: string; content: string;
  is_pinned: boolean; created_at: string; is_read: boolean;
}

// ── 工具 ──

const isDone = (c: { total_count: number; completed_count: number; has_exam: boolean; exam_passed: boolean }) =>
  c.total_count > 0 && c.completed_count >= c.total_count && (!c.has_exam || c.exam_passed);

const isStarted = (c: { completed_count: number; exam_passed: boolean }) =>
  c.completed_count > 0 || c.exam_passed;

const needExam = (c: CourseWithProgress) =>
  c.has_exam && !c.exam_passed && c.total_count > 0 && c.completed_count >= c.total_count;

function coursePercent(c: { total_count: number; completed_count: number; has_exam: boolean; exam_passed: boolean }) {
  if (c.total_count === 0) return c.has_exam ? (c.exam_passed ? 100 : 0) : 0;
  const video = c.has_exam ? (c.completed_count / c.total_count) * 80 : (c.completed_count / c.total_count) * 100;
  return Math.round(video + (c.has_exam && c.exam_passed ? 20 : 0));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(date: string, delta: number) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysLeft(end: string) {
  const e = new Date(end + "T23:59:59").getTime();
  return Math.ceil((e - Date.now()) / 86400000);
}

function fmtDuration(sec: number) {
  if (!sec) return "0 分钟";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function Bar({ pct, height = 4 }: { pct: number; height?: number }) {
  return (
    <span
      style={{
        flex: 1, display: "inline-block", height,
        background: "var(--color-bg-hover)", borderRadius: height,
        overflow: "hidden", minWidth: 40,
      }}
    >
      <span
        style={{
          display: "block", height: "100%", width: `${Math.min(100, Math.max(0, pct))}%`,
          background: "var(--color-primary)", borderRadius: height,
          transition: "width 240ms ease",
        }}
      />
    </span>
  );
}

function CardHead({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--color-border)",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--color-primary)" }}>{title}</h3>
      {extra}
    </div>
  );
}

// ── 继续学习 ──

function ContinueCard({ course, loading }: { course: CourseWithProgress | null; loading: boolean }) {
  const navigate = useNavigate();

  const sectionStyle: React.CSSProperties = { padding: "16px 18px", minHeight: 150 };

  if (loading) {
    return (
      <section className="k-card" style={sectionStyle}>
        <Skeleton width={72} height={12} />
        <div style={{ marginTop: 10 }}><Skeleton width="58%" height={18} /></div>
        <div style={{ marginTop: 14 }}><Skeleton height={6} /></div>
      </section>
    );
  }

  if (!course) {
    return (
      <section className="k-card" style={sectionStyle}>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>继续学习</div>
        <EmptyState text="暂无进行中的课程" hint="去课程中心看看分配给你的学习任务" />
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <Link to="/student/courses" className="k-btn k-btn-default k-btn-sm" style={{ textDecoration: "none" }}>
            浏览我的课程
          </Link>
        </div>
      </section>
    );
  }

  const pct = coursePercent(course);
  const started = isStarted(course);
  const label = needExam(course) ? "去参加考试" : started ? "继续学习" : "开始学习";

  return (
    <section
      className="k-card"
      style={{ padding: "16px 18px", minHeight: 150, borderColor: "var(--color-primary)", borderWidth: 1 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>继续学习</span>
        {course.end_date && (() => {
          const d = daysLeft(course.end_date);
          if (d < 0) return <span className="k-tag k-tag-danger">已逾期 {Math.abs(d)} 天</span>;
          if (d <= 3) return <span className="k-tag k-tag-danger">剩 {d} 天</span>;
          if (d <= 7) return <span className="k-tag k-tag-warning">剩 {d} 天</span>;
          return null;
        })()}
      </div>

      <h2 className="k-title" style={{ fontSize: 18, margin: "6px 0 3px", color: "var(--color-primary)", wordBreak: "break-word" }}>
        {course.title}
      </h2>
      <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        {needExam(course)
          ? "视频已全部看完，可以参加考试了"
          : started
            ? `已学 ${course.completed_count}/${course.total_count} 个视频`
            : `共 ${course.total_count} 个视频，还没有开始`}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 16px" }}>
        <Bar pct={pct} height={6} />
        <span style={{ fontSize: 13, color: "var(--color-primary)", minWidth: 34, textAlign: "right" }}>{pct}%</span>
      </div>

      <button
        type="button"
        className="k-btn k-btn-primary"
        onClick={() => navigate(`/student/courses/${course.id}`)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {label} <ArrowRight size={14} />
      </button>
    </section>
  );
}

// ── 今日计划 ──

function TodayPlanCard({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [planCourses, setPlanCourses] = useState<DailyPlanCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    setLoading(true);
    api<DailyPlan>(`/student/daily-plan?date=${date}`)
      .then((data) => {
        if (!mountedRef.current) return;
        setTasks(data.tasks ?? []);
        setPlanCourses(data.courses ?? []);
        setLoading(false);
      })
      .catch(() => { if (mountedRef.current) setLoading(false); });
  }, [date]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await api("/student/tasks", { method: "POST", body: JSON.stringify({ title, due_date: date }) });
      setNewTitle("");
      notify.success("已添加任务");
      load();
    } catch {
      notify.error("添加任务失败");
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (task: TaskItem) => {
    const next = !task.completed;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)));
    try {
      await api(`/student/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ completed: next }),
      });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)));
      notify.error("更新任务失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/student/tasks/${id}`, { method: "DELETE" });
      notify.success("已删除任务");
      load();
    } catch {
      notify.error("删除任务失败");
    }
  };

  const isToday = date === todayStr();
  const d = new Date(date + "T00:00:00");
  const doneCount = tasks.filter((t) => t.completed).length;
  const total = planCourses.length + tasks.length;

  return (
    <section className="k-card" style={{ minHeight: 260 }}>
      <CardHead
        title={isToday ? "今日计划" : `${d.getMonth() + 1}月${d.getDate()}日 计划`}
        extra={
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button" className="k-btn k-btn-ghost k-btn-sm"
              style={{ padding: "3px 6px" }} onClick={() => onDateChange(shiftDate(date, -1))}
              aria-label="前一天"
            >
              <ChevronLeft size={14} />
            </button>
            <input
              type="date" value={date} className="k-input"
              style={{ width: 138, padding: "3px 8px", fontSize: 12 }}
              onChange={(e) => e.target.value && onDateChange(e.target.value)}
            />
            <button
              type="button" className="k-btn k-btn-ghost k-btn-sm"
              style={{ padding: "3px 6px" }} onClick={() => onDateChange(shiftDate(date, 1))}
              aria-label="后一天"
            >
              <ChevronRight size={14} />
            </button>
            {!isToday && (
              <button type="button" className="k-btn k-btn-ghost k-btn-sm" onClick={() => onDateChange(todayStr())}>
                今天
              </button>
            )}
          </div>
        }
      />

      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            className="k-input"
            style={{ flex: 1 }}
            placeholder="添加新任务..."
            value={newTitle}
            disabled={adding}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
          />
          <button type="button" className="k-btn k-btn-default" onClick={handleAdd} disabled={adding || !newTitle.trim()}>
            添加
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={16} /><Skeleton height={16} /><Skeleton width="60%" height={16} />
          </div>
        ) : total === 0 ? (
          <div style={{ padding: "10px 0" }}>
            <EmptyState text="这一天还没有计划" hint="添加个人任务，或等待课程安排" />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflowY: "auto" }}>
            {planCourses.map((c) => (
              <Link
                key={c.id} to={`/student/courses/${c.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  borderRadius: 6, textDecoration: "none",
                }}
                className="k-card-hover"
              >
                <BookOpen size={13} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.title}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <Bar pct={coursePercent(c)} />
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", minWidth: 62, textAlign: "right" }}>
                    {c.total_count > 0 ? `${c.completed_count}/${c.total_count} 视频` : "暂无视频"}
                  </span>
                </span>
              </Link>
            ))}

            {planCourses.length > 0 && tasks.length > 0 && (
              <div style={{ borderTop: "1px solid var(--color-border)", margin: "6px 0" }} />
            )}

            {tasks.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                <input
                  type="checkbox" checked={t.completed} onChange={() => handleToggle(t)}
                  style={{ width: 14, height: 14, accentColor: "var(--color-primary)", cursor: "pointer", flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: t.completed ? "var(--color-text-muted)" : "var(--color-text-base)",
                    textDecoration: t.completed ? "line-through" : "none",
                  }}
                >
                  {t.title}
                </span>
                <button
                  type="button" onClick={() => handleDelete(t.id)}
                  style={{
                    marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
                    color: "var(--color-text-muted)", display: "flex", padding: 2, flexShrink: 0,
                  }}
                  aria-label="删除任务"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {tasks.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border)" }}>
            个人任务 {doneCount}/{tasks.length} 完成
          </div>
        )}
      </div>
    </section>
  );
}

// ── 即将到期 ──

function DueSoonCard({ items, loading }: { items: { c: CourseWithProgress; d: number }[]; loading: boolean }) {
  if (loading) {
    return (
      <section className="k-card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 120 }}>
        <CardHead title="即将到期" />
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={16} /><Skeleton width="70%" height={16} />
        </div>
      </section>
    );
  }

  return (
    <section className="k-card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 120 }}>
      <CardHead
        title="即将到期"
        extra={<Link to="/student/courses" className="k-link" style={{ fontSize: 12 }}>全部课程</Link>}
      />
      <div style={{ padding: "6px 16px 10px", display: "flex", flexDirection: "column", flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState text="近期没有到期的课程" />
          </div>
        ) : (
          items.map(({ c, d }) => (
            <Link
              key={c.id} to={`/student/courses/${c.id}`}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                borderBottom: "1px solid var(--color-border)", textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--color-text-base)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title}
              </span>
              <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                {d < 0 ? (
                  <span className="k-tag k-tag-danger">已逾期 {Math.abs(d)} 天</span>
                ) : d <= 3 ? (
                  <span className="k-tag k-tag-danger">剩 {d} 天</span>
                ) : d <= 7 ? (
                  <span className="k-tag k-tag-warning">剩 {d} 天</span>
                ) : (
                  <span className="k-tag">剩 {d} 天</span>
                )}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

// ── 学习概览 ──

function StatsCard({
  stats, profile, loading,
}: {
  stats: { done: number; inProgress: number; pendingExam: number; totalVideos: number; doneVideos: number; rate: number };
  profile: StudentProfile | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="k-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <CardHead title="学习概览" />
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
          <Skeleton height={16} /><Skeleton height={40} />
          <div style={{ flex: 1, minHeight: 0 }} />
        </div>
      </section>
    );
  }

  const cells = [
    { label: "进行中", value: stats.inProgress },
    { label: "已完成", value: stats.done },
    { label: "待考试", value: stats.pendingExam },
    { label: "完成率", value: `${stats.rate}%` },
  ];

  return (
    <section className="k-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <CardHead title="学习概览" />
      <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text-secondary)" }}>
          <Clock size={13} /> 累计学习时长
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, color: "var(--color-primary)", margin: "2px 0 12px" }}>
          {fmtDuration(profile?.total_watched_seconds ?? 0)}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Bar pct={stats.rate} />
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", flexShrink: 0 }}>
            视频 {stats.doneVideos}/{stats.totalVideos}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 12px" }}>
          {cells.map((c) => (
            <div key={c.label}>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: "var(--color-text-base)" }}>{c.value}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0 }} />
      </div>
    </section>
  );
}

// ── 系统公告 ──

function NoticeCard() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<NoticeItem | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    api<{ notices: NoticeItem[] }>("/notices/published")
      .then((data) => {
        if (!mountedRef.current) return;
        setNotices(data.notices ?? []);
        setLoading(false);
      })
      .catch(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const open = async (n: NoticeItem) => {
    setActive(n);
    if (n.is_read) return;
    try {
      await api(`/notices/${n.id}/read`, { method: "POST" });
      load();
    } catch {
      /* 已读标记失败不影响阅读 */
    }
  };

  return (
    <>
      <section className="k-card" style={{ minHeight: 200 }}>
        <CardHead title="系统公告" extra={<span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{notices.length} 条</span>} />
        <div className="k-scroll" style={{ padding: "6px 16px 10px", maxHeight: 320, overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
              <Skeleton height={14} /><Skeleton width="80%" height={14} />
            </div>
          ) : notices.length === 0 ? (
            <div style={{ padding: "8px 0" }}><EmptyState text="暂无公告" /></div>
          ) : (
            notices.map((n) => (
              <button
                key={n.id} type="button" onClick={() => open(n)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8, width: "100%",
                  padding: "12px 0", background: "none", border: "none", cursor: "pointer",
                  borderBottom: "1px solid var(--color-border)", textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 5, height: 5, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                    background: n.is_read ? "var(--color-border-dark)" : "var(--color-primary)",
                  }}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      fontSize: 13, display: "block", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: n.is_read ? "var(--color-text-secondary)" : "var(--color-text-base)",
                    }}
                  >
                    {n.is_pinned && <span style={{ color: "var(--color-warning)" }}>[置顶] </span>}
                    {n.title}
                  </span>
                  <span
                    style={{
                      fontSize: 11, color: "var(--color-text-muted)", display: "block",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2,
                    }}
                  >
                    {n.content}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    {new Date(n.created_at).toLocaleDateString("zh-CN")}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {active && (
        <div className="k-overlay" onClick={() => setActive(null)}>
          <div className="k-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="k-title" style={{ fontSize: 17, margin: "0 0 6px", color: "var(--color-primary)" }}>
              {active.title}
            </h3>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 14 }}>
              {new Date(active.created_at).toLocaleString("zh-CN")}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: "pre-wrap", color: "var(--color-text-base)" }}>
              {active.content}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" className="k-btn k-btn-default" onClick={() => setActive(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 首页 ──

export default function StudentDashboard() {
  const [date, setDate] = useState(todayStr);
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    Promise.all([
      api<CourseWithProgress[]>("/student/courses-with-progress"),
      api<StudentProfile>("/student/profile"),
    ])
      .then(([c, p]) => {
        if (!mountedRef.current) return;
        setCourses(c ?? []);
        setProfile(p ?? null);
        setLoading(false);
      })
      .catch(() => { if (mountedRef.current) setLoading(false); });
    return () => { mountedRef.current = false; };
  }, []);

  const stats = useMemo(() => {
    const done = courses.filter(isDone).length;
    const inProgress = courses.filter((c) => isStarted(c) && !isDone(c)).length;
    const pendingExam = courses.filter((c) => c.has_exam && !c.exam_passed).length;
    const totalVideos = courses.reduce((s, c) => s + c.total_count, 0);
    const doneVideos = courses.reduce((s, c) => s + c.completed_count, 0);
    return {
      done, inProgress, pendingExam, totalVideos, doneVideos,
      rate: totalVideos ? Math.round((doneVideos / totalVideos) * 100) : 0,
    };
  }, [courses]);

  const nextCourse = useMemo(() => {
    const active = courses.filter((c) => isStarted(c) && !isDone(c));
    if (active.length) return active[0];
    return courses.find((c) => !isStarted(c)) ?? null;
  }, [courses]);

  const dueSoon = useMemo(
    () =>
      courses
        .filter((c) => c.end_date && !isDone(c))
        .map((c) => ({ c, d: daysLeft(c.end_date as string) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 4),
    [courses]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] gap-3">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
          <ContinueCard course={nextCourse} loading={loading} />
          <TodayPlanCard date={date} onDateChange={setDate} />
          <DueSoonCard items={dueSoon} loading={loading} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
          <NoticeCard />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <StatsCard stats={stats} profile={profile} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}