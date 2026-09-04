import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface CourseWithProgress {
  id: string; title: string; description: string | null;
  cover_image: string | null; video_count: number; status: string;
  completed_count: number; total_count: number; exam_passed: boolean;
}

interface NoticeItem {
  id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  is_read: boolean;
}

interface NoticeListResponse {
  notices: NoticeItem[];
  total: number;
}

function StudentNoticeCard() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = () => {
    Promise.all([
      api<NoticeListResponse>("/notices/published"),
      api<{ unread_count: number }>("/notices/unread-count"),
    ])
      .then(([noticeRes, countRes]) => {
        if (mountedRef.current) {
          setNotices(noticeRes.notices);
          setUnreadCount(countRes.unread_count);
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

  const handleRead = async (notice: NoticeItem) => {
    setSelectedNotice(notice);
    if (!notice.is_read) {
      try {
        await api(`/notices/${notice.id}/read`, { method: "POST" });
        setNotices((prev) =>
          prev.map((n) => (n.id === notice.id ? { ...n, is_read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (e) {
        console.error("标记已读失败", e);
      }
    }
  };

  if (loading) return null;
  if (notices.length === 0) return null;

  return (
    <div className="bg-bg-base rounded-lg border border-border mb-6">
      {/* 标题行 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary">系统公告</span>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight">
              {unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* 固定高度公告列表，卡片样式 */}
      <div className="max-h-[280px] overflow-y-auto flex flex-col gap-2 p-3">
        {notices.map((n) => (
          <div
            key={n.id}
            className="border border-border rounded-lg p-3 flex items-center justify-between gap-4 hover:shadow-sm transition-shadow"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {!n.is_read && (
                  <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                )}
                {n.is_pinned && (
                  <span className="text-xs text-orange-500 font-bold shrink-0">[置顶]</span>
                )}
                <span className={`text-sm truncate ${n.is_read ? "text-text-secondary" : "font-medium"}`}>
                  {n.title}
                </span>
              </div>
              <span className="text-xs text-text-secondary ml-4">
                {new Date(n.created_at).toLocaleString("zh-CN")}
              </span>
            </div>
            <button
              onClick={() => handleRead(n)}
              className="shrink-0 ml-3 px-3 py-1 text-xs bg-primary text-white rounded-md hover:bg-primary/90"
            >
              查看
            </button>
          </div>
        ))}
      </div>

      {/* 详情弹窗 */}
      {selectedNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg w-full max-w-lg mx-4 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-primary mb-2">{selectedNotice.title}</h3>
            <p className="text-xs text-text-secondary mb-4">
              {new Date(selectedNotice.created_at).toLocaleString("zh-CN")}
            </p>
            <div className="text-sm text-text-base whitespace-pre-wrap max-h-60 overflow-y-auto">
              {selectedNotice.content}
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setSelectedNotice(null)}
                className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
  );
}

export default function StudentDashboard() {
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in_progress" | "done">("all");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api<CourseWithProgress[]>("/student/courses-with-progress")
      .then((data) => {
        if (mountedRef.current) {
          setCourses(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => { mountedRef.current = false; };
  }, []);

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

  return (
    <div>
      <StudentNoticeCard />

      <h2 className="text-xl font-bold text-primary mb-4">我的课程</h2>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCourses.map((c) => {
            const isDone = (c.total_count > 0 && c.completed_count >= c.total_count) && c.exam_passed;
            const pct = isDone ? 100 : (c.total_count > 0
              ? Math.round((c.completed_count / c.total_count) * 100)
              : 0);

            return (
              <Link
                key={c.id}
                to={`/student/courses/${c.id}`}
                className="bg-bg-base rounded-lg border border-border hover:shadow-md transition-shadow p-4"
              >
                <h3 className="font-bold text-sm mb-2">{c.title}</h3>
                {c.description && (
                  <p className="text-xs text-text-secondary mb-3 line-clamp-2">{c.description}</p>
                )}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                    <span>{c.total_count} 个视频</span>
                    <span className="text-primary">
                      {c.exam_passed && c.total_count === 0
                        ? "考试已通过"
                        : `${c.completed_count}/${c.total_count} 完成`}
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
          })}
        </div>
      )}
    </div>
  );
}