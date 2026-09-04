import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../lib/api";

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
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const unreadCount = notices.filter((n) => !n.is_read).length;

  const fetchData = () => {
    api<NoticeListResponse>("/notices/published")
      .then((data) => {
        if (mountedRef.current) {
          setNotices(data.notices);
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
        fetchData();
      } catch (e) {
        console.error("标记已读失败", e);
      }
    }
  };

  if (loading) return null;
  if (notices.length === 0) return null;

  return (
    <div className="bg-bg-base rounded-lg border border-border">
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

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function TodoPanel() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const mountedRef = useRef(true);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await api<TaskItem[]>(
        `/student/tasks?date=${selectedDate}`
      );
      if (mountedRef.current) {
        setTasks(data);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    mountedRef.current = true;
    fetchTasks();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchTasks]);

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await api("/student/tasks", {
        method: "POST",
        body: JSON.stringify({ title, due_date: selectedDate }),
      });
      setNewTitle("");
      fetchTasks();
    } catch (e) {
      console.error("添加任务失败", e);
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (task: TaskItem) => {
    try {
      await api(`/student/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ completed: !task.completed }),
      });
      fetchTasks();
    } catch (e) {
      console.error("更新任务失败", e);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await api(`/student/tasks/${taskId}`, { method: "DELETE" });
      fetchTasks();
    } catch (e) {
      console.error("删除任务失败", e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd();
    }
  };

  return (
    <div className="bg-bg-base rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-bold text-primary">代办任务</span>
      </div>
      <div className="flex gap-0 p-0">
        {/* 左侧：日期选择器 */}
        <div className="w-56 shrink-0 p-4 border-r border-border">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                       bg-bg-base"
          />
          <p className="text-xs text-text-secondary mt-2 text-center">
            {selectedDate === new Date().toISOString().split("T")[0]
              ? "今天"
              : selectedDate}
          </p>
        </div>

        {/* 右侧：任务列表 */}
        <div className="flex-1 min-w-0">
          {/* 添加任务输入框 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="添加新任务..."
              className="flex-1 px-3 py-1.5 border border-border rounded-md text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                         bg-bg-base"
              disabled={adding}
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newTitle.trim()}
              className="px-3 py-1.5 text-sm bg-primary text-white rounded-md
                         hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? "添加中..." : "添加"}
            </button>
          </div>

          {/* 任务列表 */}
          <div className="max-h-[280px] overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-text-secondary">加载中...</p>
            ) : tasks.length === 0 ? (
              <p className="p-4 text-sm text-text-secondary text-center">
                暂无任务
              </p>
            ) : (
              <div className="flex flex-col gap-1 p-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-bg-layout group"
                  >
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={() => handleToggle(task)}
                      className="w-4 h-4 rounded border-border accent-primary cursor-pointer shrink-0"
                    />
                    <span
                      className={`flex-1 text-sm truncate ${
                        task.completed
                          ? "line-through text-text-secondary"
                          : "text-text-base"
                      }`}
                    >
                      {task.title}
                    </span>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  return (
    <div className="space-y-4">
      <StudentNoticeCard />
      <TodoPanel />
    </div>
  );
}