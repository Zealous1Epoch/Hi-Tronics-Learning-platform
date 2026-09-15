import { useState, useEffect, useRef } from "react";
import { Users, BookOpen, Play, CheckCircle, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";

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
  author_id: string;
  status: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  read_count: number;
  total_users: number;
}

interface NoticeListResponse {
  notices: NoticeItem[];
  total: number;
}

// ── 公告编辑弹窗 ──

function NoticeModal({
  open,
  onClose,
  editItem,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editItem: NoticeItem | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("published");
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editItem) {
        setTitle(editItem.title);
        setContent(editItem.content);
        setStatus(editItem.status as "draft" | "published");
        setIsPinned(editItem.is_pinned);
      } else {
        setTitle("");
        setContent("");
        setStatus("published");
        setIsPinned(false);
      }
    }
  }, [open, editItem]);

  if (!open) return null;

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
      onSaved();
      onClose();
    } catch (e) {
      console.error("保存公告失败", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-base rounded-lg w-full max-w-lg mx-4 p-6 shadow-xl border border-border">
        <h3 className="text-lg font-bold text-primary mb-4">
          {editItem ? "编辑公告" : "发布公告"}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              placeholder="请输入公告标题"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
              placeholder="请输入公告内容"
            />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={status === "published"}
                onChange={() => setStatus("published")}
              />
              直接发布
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={status === "draft"}
                onChange={() => setStatus("draft")}
              />
              保存草稿
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
              />
              置顶
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-md hover:bg-bg-layout"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 公告面板 ──

function AdminNoticePanel() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<NoticeItem | null>(null);
  const mountedRef = useRef(true);

  const fetchNotices = () => {
    setLoading(true);
    api<NoticeListResponse>("/notices?page=1&page_size=5")
      .then((data) => {
        if (mountedRef.current) {
          setNotices(data.notices);
          setTotal(data.total);
          setLoading(false);
        }
      })
      .catch(() => {
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

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`确定要删除公告「${title}」吗？`)) return;
    try {
      await api(`/notices/${id}`, { method: "DELETE" });
      fetchNotices();
    } catch (e) {
      console.error("删除失败", e);
    }
  };

  const handleEdit = (item: NoticeItem) => {
    setEditItem(item);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditItem(null);
    setModalOpen(true);
  };

  const statusLabel = (s: string) =>
    s === "published" ? (
      <span className="text-green-600 text-xs">已发布</span>
    ) : (
      <span className="text-yellow-600 text-xs">草稿</span>
    );

  return (
    <div className="bg-bg-base rounded-lg border border-border p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="text-base font-bold text-primary">公告管理</h3>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary/90"
        >
          + 发布
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-text-secondary">加载中...</p>
        ) : notices.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无公告</p>
        ) : (
          <div className="flex flex-col">
            {notices.map((n, i) => (
              <div
                key={n.id}
                className={`flex items-start justify-between gap-4 py-3 ${
                  i < notices.length - 1 ? "border-b border-border/60" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {n.is_pinned && (
                      <span className="text-[11px] text-orange-500 font-bold">置顶</span>
                    )}
                    <span className="text-sm font-medium truncate">{n.title}</span>
                    {statusLabel(n.status)}
                  </div>
                  <div className="text-xs text-text-secondary/60 mt-0.5">
                    {new Date(n.created_at).toLocaleString("zh-CN")} · 已读 {n.read_count}/{n.total_users}
                  </div>
                </div>
                <div className="flex gap-3 shrink-0 pt-0.5">
                  <button
                    onClick={() => handleEdit(n)}
                    className="text-xs text-text-secondary hover:text-primary transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(n.id, n.title)}
                    className="text-xs text-text-secondary/60 hover:text-red-500 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {total > 5 && (
          <p className="text-xs text-text-secondary mt-2 text-center">共 {total} 条公告</p>
        )}
      </div>

      {modalOpen && (
        <NoticeModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          editItem={editItem}
          onSaved={fetchNotices}
        />
      )}
    </div>
  );
}

// ── 最近动态 ──

function RecentActivities() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api<ActivityItem[]>("/admin/recent-activities")
      .then((data) => {
        if (mountedRef.current) {
          setActivities(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  // 按学员分组
  const grouped = activities.reduce<Record<string, ActivityItem[]>>((acc, a) => {
    if (!acc[a.user_name]) acc[a.user_name] = [];
    acc[a.user_name].push(a);
    return acc;
  }, {});

  return (
    <div className="bg-bg-base rounded-lg border border-border p-4 h-full flex flex-col">
      <h3 className="text-base font-bold text-primary mb-4 shrink-0">最近动态</h3>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-text-secondary">加载中...</p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无动态</p>
        ) : (
          <div className="flex flex-col">
            {Object.entries(grouped).map(([userName, items]) => {
            const isExpanded = expandedUser === userName;
            return (
              <div
                key={userName}
                className="border-b border-border/60 last:border-0"
              >
                <button
                  onClick={() => setExpandedUser(isExpanded ? null : userName)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{userName}</span>
                    <span className="text-xs text-text-secondary bg-bg-layout rounded-full px-2 py-0.5">
                      {items.length}
                    </span>
                  </div>
                  <ChevronDown size={14} className={`text-text-secondary transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
                {isExpanded && (
                  <div className="border-t border-border/40 px-3 py-2 space-y-2">
                    {items.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                            a.type === "exam" ? "bg-green-500" : "bg-blue-500"
                          }`}
                        />
                        <div>
                          <div>
                            <span className="text-text-secondary">{a.action} </span>
                            <span>{a.target}</span>
                          </div>
                          <div className="text-xs text-text-secondary">
                            {new Date(a.time).toLocaleString("zh-CN")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

// ── 主页面 ──

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api<DashboardStats>("/admin/dashboard-stats")
      .then((data) => {
        if (mountedRef.current) {
          setStats(data);
          setStatsLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setStatsLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  const statCards = [
    { label: "总学员", value: stats?.total_students ?? 0, icon: Users, color: "text-blue-500" },
    { label: "总课程", value: stats?.total_courses ?? 0, icon: BookOpen, color: "text-emerald-500" },
    { label: "进行中", value: stats?.in_progress ?? 0, icon: Play, color: "text-amber-500" },
    { label: "已完成", value: stats?.completed ?? 0, icon: CheckCircle, color: "text-primary" },
  ];

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-xl font-bold text-primary mb-5">管理后台首页</h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-bg-base rounded-xl border border-border p-4 flex items-center gap-3 hover:border-primary/20 hover:shadow-sm transition-all">
            <div className={`${s.color} shrink-0`}>
              <s.icon size={22} strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-xl font-bold text-primary">
                {statsLoading ? "-" : s.value}
              </div>
              <div className="text-xs text-text-secondary">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 两列布局：左侧公告，右侧动态 */}
      <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
        <AdminNoticePanel />
        <RecentActivities />
      </div>
    </div>
  );
}