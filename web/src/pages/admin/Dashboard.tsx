import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, BookOpen, Play, CheckCircle, Megaphone,
  ClipboardList, CircleDot, UserX, FileText, ChevronDown,
} from "lucide-react";
import { api } from "../../lib/api";
import { Skeleton, EmptyState, Tag } from "../../components/ui/Misc";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/Confirm";

// ── 类型 ──

interface DashboardStats {
  total_students: number;
  total_courses: number;
  in_progress: number;
  completed: number;
}

interface ActivityItem {
  time: string;
  user_name: string;
  action: string;
  target: string;
  type: "course" | "exam";
}

interface NoticeItem {
  id: string;
  title: string;
  content: string;
  status: string;
  is_pinned: boolean;
  created_at: string;
  read_count: number;
  total_users: number;
}

const RANGES = [
  { label: "近 7 天", days: 7 },
  { label: "近 14 天", days: 14 },
  { label: "近 30 天", days: 30 },
];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildDayRange(days: number) {
  const result: { day: string; value: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    result.push({ day: dayKey(d), value: 0 });
  }
  return result;
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

// ── 趋势图（纯 SVG，无第三方图表库）──

function TrendChart({
  courseData, examData, loading,
}: {
  courseData: { day: string; value: number }[];
  examData: { day: string; value: number }[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%", minHeight: 100 }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <Skeleton key={i} height={34 + ((i * 37) % 64)} />
        ))}
      </div>
    );
  }
  const allZero = courseData.every((d) => d.value === 0) && examData.every((d) => d.value === 0);
  if (courseData.length === 0 || allZero) {
    return (
      <EmptyState
        text="该时间范围内暂无动态记录"
        hint="动态数据来源于最近的学习与考试记录"
      />
    );
  }

  const W = 640;
  const H = 132;
  const padL = 28;
  const padR = 12;
  const padB = 16;
  const padT = 10;
  const allValues = [...courseData.map((d) => d.value), ...examData.map((d) => d.value)];
  const max = Math.max(...allValues, 1);
  const stepX = (W - padL - padR) / Math.max(courseData.length - 1, 1);
  const chartH = H - padT - padB;

  const toLine = (data: { day: string; value: number }[]) =>
    data.map((d, i) => ({
      x: padL + i * stepX,
      y: padT + chartH * (1 - d.value / max),
      ...d,
    }));

  const cPoints = toLine(courseData);
  const ePoints = toLine(examData);
  const cArea = `${padL},${H - padB} ${cPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} ${cPoints[cPoints.length - 1].x.toFixed(1)},${H - padB}`;
  const eArea = `${padL},${H - padB} ${ePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} ${ePoints[ePoints.length - 1].x.toFixed(1)},${H - padB}`;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 图例 */}
      <div style={{ display: "flex", gap: 16, fontSize: 11, marginBottom: 6, color: "var(--color-text-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 2, background: "var(--color-primary)", borderRadius: 1 }} />
          课程
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 2, background: "var(--color-success)", borderRadius: 1 }} />
          考试
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block", flex: 1, minHeight: 0 }} role="img">
        <title>课程与考试动态趋势</title>
        <desc>按天统计的课程学习与考试参与动态</desc>
        {[0, 0.5, 1].map((r) => {
          const y = padT + chartH * r;
          return (
            <g key={r}>
              <line
                x1={padL} y1={y} x2={W - padR} y2={y}
                stroke="var(--color-border)"
                strokeWidth="0.5"
                strokeDasharray={r === 1 ? undefined : "3 3"}
              />
              <text x={0} y={y + 3} fontSize="10" fill="var(--color-text-muted)">
                {Math.round(max * (1 - r))}
              </text>
            </g>
          );
        })}
        <polygon points={cArea} fill="rgba(27,54,93,0.06)" />
        <polyline points={cPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {cPoints.map((p, i) =>
          p.value > 0 ? <circle key={`c${i}`} cx={p.x} cy={p.y} r="2.5" fill="var(--color-primary)" /> : null
        )}
        <polygon points={eArea} fill="rgba(47,122,79,0.07)" />
        <polyline points={ePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke="var(--color-success)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {ePoints.map((p, i) =>
          p.value > 0 ? <circle key={`e${i}`} cx={p.x} cy={p.y} r="2.5" fill="var(--color-success)" /> : null
        )}
        {cPoints.filter((_, i) => i % Math.ceil(courseData.length / 7) === 0).map((p, i) => (
          <text key={`t${i}`} x={p.x} y={H - 6} fontSize="10" fill="var(--color-text-muted)" textAnchor="middle">
            {p.day.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── 公告面板 ──

function NoticeModal({
  editItem,
  onClose,
  onSaved,
}: {
  editItem: NoticeItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(editItem?.title ?? "");
  const [content, setContent] = useState(editItem?.content ?? "");
  const [status, setStatus] = useState<"draft" | "published">(
    (editItem?.status as "draft" | "published") ?? "published"
  );
  const [isPinned, setIsPinned] = useState(editItem?.is_pinned ?? false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (editItem) {
        await api(`/notices/${editItem.id}`, {
          method: "PUT",
          body: JSON.stringify({ title, content, status, is_pinned: isPinned }),
        });
      } else {
        await api("/notices", {
          method: "POST",
          body: JSON.stringify({ title, content, status, is_pinned: isPinned }),
        });
      }
      toast.success(editItem ? "公告已更新" : "公告已发布");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="k-overlay" onClick={onClose}>
      <div className="k-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="k-title" style={{ fontSize: 15, margin: "0 0 16px", color: "var(--color-text-base)" }}>
          {editItem ? "编辑公告" : "发布公告"}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="k-label">标题</label>
            <input className="k-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="请输入公告标题" />
          </div>
          <div>
            <label className="k-label">内容</label>
            <textarea
              className="k-textarea"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请输入公告内容"
            />
          </div>
          <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="radio" checked={status === "published"} onChange={() => setStatus("published")} />
              直接发布
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="radio" checked={status === "draft"} onChange={() => setStatus("draft")} />
              保存草稿
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
              置顶
            </label>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button className="k-btn k-btn-default" onClick={onClose}>
            取消
          </button>
          <button className="k-btn k-btn-primary" onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeDetailModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    api<{ notices: NoticeItem[] }>("/notices?page=1&page_size=100")
      .then((d) => { if (mounted) setList(d.notices ?? []); })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  return (
    <div className="k-overlay" onClick={onClose}>
      <div className="k-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "92%" }}>
        <h3 className="k-title" style={{ fontSize: 15, margin: "0 0 12px", color: "var(--color-text-base)" }}>
          公告详情
        </h3>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={16} /><Skeleton height={40} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState text="暂无公告" />
        ) : (
          <div className="k-scroll" style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            {list.map((n) => (
              <div key={n.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{n.title}</span>
                  {n.is_pinned && <Tag tone="warning">置顶</Tag>}
                  {n.status === "published" ? <Tag tone="success">已发布</Tag> : <Tag tone="default">草稿</Tag>}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 6px" }}>
                  {new Date(n.created_at).toLocaleString("zh-CN")} · 已读 {n.read_count}/{n.total_users}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--color-text-base)" }}>
                  {n.content}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="k-btn k-btn-default" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function NoticePanel() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ item: NoticeItem | null } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const mountedRef = useRef(true);
  const confirm = useConfirm();
  const toast = useToast();

  const fetchNotices = () => {
    setLoading(true);
    api<{ notices: NoticeItem[]; total: number }>("/notices?page=1&page_size=3")
      .then((data) => {
        if (!mountedRef.current) return;
        setNotices(data.notices ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchNotices();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleDelete = async (item: NoticeItem) => {
    const ok = await confirm({
      title: `删除公告「${item.title}」？`,
      message: "删除后学员端将立即不可见，且无法恢复。",
      danger: true,
      confirmText: "删除",
    });
    if (!ok) return;
    try {
      await api(`/notices/${item.id}`, { method: "DELETE" });
      toast.success("公告已删除");
      fetchNotices();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <section className="k-card">
      <div className="k-card-head">
        <h3 className="k-card-title">公告管理</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="k-btn k-btn-ghost k-btn-sm" onClick={() => setDetailOpen(true)}>
            查看详情
          </button>
          <button className="k-btn k-btn-primary k-btn-sm" onClick={() => setModal({ item: null })}>
            <Megaphone size={13} /> 发布公告
          </button>
        </div>
      </div>
      <div className="k-card-body k-scroll" style={{ padding: "4px 18px 8px", maxHeight: 300, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "12px 0" }}>
            <Skeleton height={16} />
          </div>
        ) : notices.length === 0 ? (
          <EmptyState text="暂无公告" />
        ) : (
          notices.map((n, i) => (
            <div
              key={n.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                padding: "11px 0",
                borderBottom:
                  i < notices.length - 1 ? "1px solid rgba(232,230,220,0.7)" : "none",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{n.title}</span>
                  {n.is_pinned && <Tag tone="warning">置顶</Tag>}
                  {n.status === "published" ? (
                    <Tag tone="success">已发布</Tag>
                  ) : (
                    <Tag tone="default">草稿</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
                  {new Date(n.created_at).toLocaleDateString("zh-CN")} · 已读 {n.read_count}/
                  {n.total_users}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, flexShrink: 0, paddingTop: 2 }}>
                <button className="k-link" onClick={() => setModal({ item: n })}>
                  编辑
                </button>
                <button className="k-link k-link-danger" onClick={() => handleDelete(n)}>
                  删除
                </button>
              </div>
            </div>
          ))
        )}
        {total > 6 && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "8px 0" }}>
            共 {total} 条公告
          </div>
        )}
      </div>
      {modal && (
        <NoticeModal
          editItem={modal.item}
          onClose={() => setModal(null)}
          onSaved={fetchNotices}
        />
      )}
      {detailOpen && <NoticeDetailModal onClose={() => setDetailOpen(false)} />}
    </section>
  );
}

// ── 动态详情弹窗 ──

function ActivityDetailModal({ items, onClose }: { items: ActivityItem[]; onClose: () => void }) {
  return (
    <div className="k-overlay" onClick={onClose}>
      <div className="k-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "92%" }}>
        <h3 className="k-title" style={{ fontSize: 15, margin: "0 0 12px", color: "var(--color-text-base)" }}>
          动态详情
        </h3>
        <div className="k-scroll" style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {items.length === 0 ? (
            <EmptyState text="该时间范围内暂无动态" />
          ) : (
            items.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--color-border)", paddingBottom: 10 }}>
                <CircleDot
                  size={12}
                  strokeWidth={1.6}
                  style={{
                    color: a.type === "exam" ? "var(--color-success)" : "var(--color-primary)",
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{a.user_name} </span>
                    {a.action} <span style={{ fontWeight: 500 }}>{a.target}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{relativeTime(a.time)}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="k-btn k-btn-default" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ──

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(7);
  const [todo, setTodo] = useState({ draftCourses: 0, activeExams: 0, inactiveUsers: 0, draftNotices: 0 });
  const [activityDetailOpen, setActivityDetailOpen] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api<DashboardStats>("/admin/dashboard-stats"),
      api<ActivityItem[]>("/admin/recent-activities"),
    ])
      .then(([s, a]) => {
        if (!mountedRef.current) return;
        setStats(s);
        setActivities(a ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 待办数据：全部基于现有接口在前端聚合，不需要后端改动
  useEffect(() => {
    Promise.all([
      api<{ status?: string }[]>("/courses").catch(() => []),
      api<{ status?: string; end_time?: string }[]>("/exams").catch(() => []),
      api<{ status?: string }[]>("/users?role=student&page_size=200").catch(() => []),
      api<{ notices: { status: string }[] }>("/notices?page=1&page_size=100").catch(() => ({
        notices: [],
      })),
    ]).then(([courses, exams, users, noticeRes]) => {
      if (!mountedRef.current) return;
      const now = Date.now();
      setTodo({
        draftCourses: courses.filter((c) => c.status !== "published").length,
        activeExams: exams.filter(
          (e) => e.status === "published" && (!e.end_time || new Date(e.end_time).getTime() > now)
        ).length,
        inactiveUsers: users.filter((u) => u.status && u.status !== "active").length,
        draftNotices: (noticeRes.notices ?? []).filter((n) => n.status === "draft").length,
      });
    });
  }, []);

  const courseTrend = useMemo(() => {
    const days = buildDayRange(rangeDays);
    const map = new Map(days.map((d) => [d.day, 0]));
    activities.filter((a) => a.type === "course").forEach((a) => {
      const k = dayKey(new Date(a.time));
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    });
    return days.map((d) => ({ day: d.day, value: map.get(d.day) ?? 0 }));
  }, [activities, rangeDays]);

  const examTrend = useMemo(() => {
    const days = buildDayRange(rangeDays);
    const map = new Map(days.map((d) => [d.day, 0]));
    activities.filter((a) => a.type === "exam").forEach((a) => {
      const k = dayKey(new Date(a.time));
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    });
    return days.map((d) => ({ day: d.day, value: map.get(d.day) ?? 0 }));
  }, [activities, rangeDays]);

  const visibleActivities = useMemo(() => {
    const cutoff = Date.now() - rangeDays * 86400000;
    return activities.filter((a) => new Date(a.time).getTime() >= cutoff).slice(0, 8);
  }, [activities, rangeDays]);

  const detailActivities = useMemo(() => {
    const cutoff = Date.now() - rangeDays * 86400000;
    return activities.filter((a) => new Date(a.time).getTime() >= cutoff);
  }, [activities, rangeDays]);

  const completionRate =
    stats && stats.total_students > 0
      ? ((stats.completed / stats.total_students) * 100).toFixed(1)
      : "—";

  const todoCards = [
    { label: "待发布课程", value: todo.draftCourses, unit: "门", icon: BookOpen, to: "/admin/courses" },
    { label: "进行中考试", value: todo.activeExams, unit: "场", icon: ClipboardList, to: "/admin/exams" },
    { label: "待激活账号", value: todo.inactiveUsers, unit: "人", icon: UserX, to: "/admin/users" },
    { label: "草稿公告", value: todo.draftNotices, unit: "条", icon: FileText, to: "/admin/courses" },
  ];

  const statCards = [
    {
      label: "总学员",
      value: stats?.total_students ?? 0,
      sub: `待激活 ${todo.inactiveUsers} 人`,
      icon: Users,
      to: "/admin/users",
    },
    {
      label: "总课程",
      value: stats?.total_courses ?? 0,
      sub: `草稿 ${todo.draftCourses} 门`,
      icon: BookOpen,
      to: "/admin/courses",
    },
    {
      label: "进行中",
      value: stats?.in_progress ?? 0,
      sub: `覆盖 ${stats && stats.total_students ? ((stats.in_progress / stats.total_students) * 100).toFixed(0) : 0}% 学员`,
      icon: Play,
      to: "/admin/users/progress",
    },
    {
      label: "已完成",
      value: stats?.completed ?? 0,
      sub: `完成率 ${completionRate}%`,
      icon: CheckCircle,
      to: "/admin/users/progress",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {todoCards.map((t) => (
          <div
            key={t.label}
            className="k-card k-card-hover"
            style={{ padding: "12px 14px", borderLeft: "2px solid var(--color-primary)", cursor: "pointer" }}
            onClick={() => navigate(t.to)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--color-text-secondary)", fontSize: 12 }}>
              <t.icon size={13} strokeWidth={1.6} />
              {t.label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 500, color: "var(--color-primary)" }}>
                {t.value}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-4 items-stretch" style={{ flex: 1, minHeight: 0 }}>
        <section className="k-card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <div className="k-card-head">
            <h3 className="k-card-title">学习动态趋势</h3>
            <div style={{ display: "flex", border: "1px solid var(--color-border-dark)", borderRadius: 6, overflow: "hidden" }}>
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setRangeDays(r.days)}
                  style={{
                    padding: "3px 10px",
                    fontSize: 11,
                    border: "none",
                    borderLeft: r.days === 7 ? "none" : "1px solid var(--color-border)",
                    background: rangeDays === r.days ? "var(--color-primary)" : "transparent",
                    color: rangeDays === r.days ? "#fff" : "var(--color-text-secondary)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="k-card-body" style={{ flex: 1, minHeight: 0, padding: "8px 18px 6px" }}>
            <TrendChart courseData={courseTrend} examData={examTrend} loading={loading} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 0,
              borderTop: "1px solid var(--color-border)",
            }}
          >
            {statCards.map((s) => (
              <div
                key={s.label}
                className="k-card-hover"
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  borderRight: "1px solid var(--color-border)",
                  borderBottom: "1px solid var(--color-border)",
                }}
                onClick={() => navigate(s.to)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{s.label}</span>
                  <s.icon size={14} strokeWidth={1.6} style={{ color: "var(--color-primary)" }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 500, color: "var(--color-primary)", marginTop: 4, lineHeight: 1.2 }}>
                  {loading ? <Skeleton width={50} height={22} /> : s.value.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0, height: "100%" }}>
          <NoticePanel />

          <section className="k-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="k-card-head">
              <h3 className="k-card-title">最近动态</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  {visibleActivities.length} 条
                </span>
                <button className="k-btn k-btn-ghost k-btn-sm" onClick={() => setActivityDetailOpen(true)}>
                  查看详情
                </button>
              </div>
            </div>
            <div className="k-card-body k-scroll" style={{ flex: 1, minHeight: 0, padding: "6px 0 6px", overflowY: "auto" }}>
              {loading ? (
                <Skeleton height={16} />
              ) : visibleActivities.length === 0 ? (
                <div style={{ padding: "12px 18px" }}><EmptyState text="该时间范围内暂无动态" /></div>
              ) : (
                (() => {
                  const grouped = visibleActivities.reduce<Record<string, typeof visibleActivities>>((acc, a) => {
                    if (!acc[a.user_name]) acc[a.user_name] = [];
                    acc[a.user_name].push(a);
                    return acc;
                  }, {});
                  return Object.entries(grouped).map(([userName, items]) => {
                    const isExpanded = expandedUser === userName;
                    return (
                      <div key={userName}>
                        <button
                          onClick={() => setExpandedUser(isExpanded ? null : userName)}
                          className="k-nav-item"
                          style={{
                            width: "100%",
                            background: "none",
                            border: "none",
                            fontFamily: "inherit",
                            cursor: "pointer",
                            borderRadius: 0,
                            justifyContent: "space-between",
                            padding: "8px 18px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <ChevronDown
                              size={12}
                              style={{
                                transition: "transform 160ms ease",
                                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                                color: "var(--color-text-muted)",
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{userName}</span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-muted)",
                                background: "var(--color-bg-hover)",
                                borderRadius: 10,
                                padding: "0 7px",
                                lineHeight: "18px",
                              }}
                            >
                              {items.length}
                            </span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div style={{ borderTop: "1px solid var(--color-border)", padding: "4px 18px 8px" }}>
                            {items.map((a, i) => (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  padding: "7px 0",
                                  borderBottom:
                                    i < items.length - 1 ? "1px solid rgba(232,230,220,0.7)" : "none",
                                }}
                              >
                                <CircleDot
                                  size={12}
                                  strokeWidth={1.6}
                                  style={{
                                    color: a.type === "exam" ? "var(--color-success)" : "var(--color-primary)",
                                    marginTop: 4,
                                    flexShrink: 0,
                                  }}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                                    {a.action} <span style={{ fontWeight: 500 }}>{a.target}</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                    {relativeTime(a.time)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </section>
        </div>
      </div>

      {activityDetailOpen && (
        <ActivityDetailModal items={detailActivities} onClose={() => setActivityDetailOpen(false)} />
      )}
    </div>
  );
}