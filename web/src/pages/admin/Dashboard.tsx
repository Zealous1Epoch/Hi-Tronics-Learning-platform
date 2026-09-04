import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
      <div className="bg-white rounded-lg w-full max-w-lg mx-4 p-6 shadow-xl">
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
    <div className="bg-bg-base rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-primary">公告管理</h3>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary/90"
        >
          + 发布
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-secondary">加载中...</p>
      ) : notices.length === 0 ? (
        <p className="text-sm text-text-secondary">暂无公告</p>
      ) : (
        <ul className="divide-y divide-border">
          {notices.map((n) => (
            <li key={n.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {n.is_pinned && (
                    <span className="text-xs text-orange-500 font-bold">[置顶]</span>
                  )}
                  <span className="text-sm font-medium truncate">{n.title}</span>
                  {statusLabel(n.status)}
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  {new Date(n.created_at).toLocaleString("zh-CN")} | 已读 {n.read_count}/{n.total_users}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleEdit(n)}
                  className="text-xs text-primary hover:underline"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(n.id, n.title)}
                  className="text-xs text-red-500 hover:underline"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > 5 && (
        <p className="text-xs text-text-secondary mt-2 text-center">共 {total} 条公告</p>
      )}

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

// ── 快捷操作 ──

const QUICK_ACTIONS = [
  { label: "创建课程", path: "/admin/courses", desc: "添加新课程及视频章节" },
  { label: "发布考试", path: "/admin/exams", desc: "创建试卷并关联课程" },
  { label: "导入学员", path: "/admin/users", desc: "批量导入学员账号" },
];

function QuickActions() {
  const navigate = useNavigate();

  return (
    <div className="bg-bg-base rounded-lg border border-border p-4">
      <h3 className="text-base font-bold text-primary mb-4">快捷操作</h3>
      <div className="flex flex-col gap-3">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.path}
            onClick={() => navigate(a.path)}
            className="w-full text-left px-4 py-3 rounded-md border border-border hover:bg-bg-layout hover:border-primary transition-colors"
          >
            <div className="text-sm font-medium text-primary">{a.label}</div>
            <div className="text-xs text-text-secondary mt-0.5">{a.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 最近动态 ──

function RecentActivities() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
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

  return (
    <div className="bg-bg-base rounded-lg border border-border p-4">
      <h3 className="text-base font-bold text-primary mb-4">最近动态</h3>
      {loading ? (
        <p className="text-sm text-text-secondary">加载中...</p>
      ) : activities.length === 0 ? (
        <p className="text-sm text-text-secondary">暂无动态</p>
      ) : (
        <div className="max-h-[280px] overflow-y-auto">
          <ul className="divide-y divide-border">
            {activities.map((a, i) => (
              <li key={i} className="py-2.5 flex items-start gap-3">
                <span
                  className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                    a.type === "exam" ? "bg-green-500" : "bg-blue-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{a.user_name}</span>
                    <span className="text-text-secondary"> {a.action} </span>
                    <span>{a.target}</span>
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">
                    {new Date(a.time).toLocaleString("zh-CN")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
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
    { label: "总学员", value: stats?.total_students ?? 0 },
    { label: "总课程", value: stats?.total_courses ?? 0 },
    { label: "进行中", value: stats?.in_progress ?? 0 },
    { label: "已完成", value: stats?.completed ?? 0 },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">管理后台首页</h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-bg-base rounded-lg p-4 border border-border text-center">
            <div className="text-2xl font-bold text-primary">
              {statsLoading ? "-" : s.value}
            </div>
            <div className="text-sm text-text-secondary">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 两列布局：左侧公告 + 动态，右侧快捷操作 */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <AdminNoticePanel />
          <RecentActivities />
        </div>
        <div className="col-span-1">
          <QuickActions />
        </div>
      </div>
    </div>
  );
}