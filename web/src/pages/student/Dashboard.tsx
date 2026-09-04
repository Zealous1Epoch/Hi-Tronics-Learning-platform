import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../lib/api";

// ── 公告组件 ──

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

function NoticeSection() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [activeNotice, setActiveNotice] = useState<NoticeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = () => {
    api<NoticeListResponse>("/notices/published")
      .then((data) => {
        if (mountedRef.current) {
          setNotices(data.notices);
          if (data.notices.length > 0) {
            setActiveNotice(data.notices[0]);
          }
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

  const handleSelect = async (notice: NoticeItem) => {
    setActiveNotice(notice);
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
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-bold text-primary">系统公告</span>
      </div>
      <div className="flex gap-0">
        {/* 左侧 2/3：当前公告详情 */}
        <div className="w-2/3 p-4 border-r border-border min-h-[180px]">
          {activeNotice ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {activeNotice.is_pinned && (
                  <span className="text-xs text-orange-500 font-bold shrink-0">[置顶]</span>
                )}
                <h3 className="text-base font-bold text-primary">{activeNotice.title}</h3>
              </div>
              <p className="text-xs text-text-secondary mb-3">
                {new Date(activeNotice.created_at).toLocaleString("zh-CN")}
              </p>
              <div className="text-sm text-text-base whitespace-pre-wrap leading-relaxed">
                {activeNotice.content}
              </div>
            </>
          ) : (
            <p className="text-sm text-text-secondary">暂无公告</p>
          )}
        </div>

        {/* 右侧 1/3：历史公告列表 */}
        <div className="w-1/3 max-h-[300px] overflow-y-auto p-2">
          {notices.length <= 1 ? (
            <p className="text-sm text-text-secondary text-center py-8">暂无历史公告</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notices.slice(1).map((n) => (
                <div
                  key={n.id}
                  className={`border rounded-lg p-3 cursor-pointer hover:shadow-sm transition-shadow ${
                    activeNotice?.id === n.id ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  onClick={() => handleSelect(n)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {!n.is_read && (
                      <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                    )}
                    {n.is_pinned && (
                      <span className="text-xs text-orange-500 font-bold shrink-0">[置顶]</span>
                    )}
                    <span className="text-xs font-medium truncate">{n.title}</span>
                  </div>
                  <p className="text-xs text-text-secondary line-clamp-2">{n.content}</p>
                  <p className="text-xs text-text-secondary mt-1">
                    {new Date(n.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 月历组件 ──

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

function getMonthDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  while (days.length < 35) days.push(null);
  return days;
}

function Calendar({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const [year, month] = selectedDate.split("-").slice(0, 2).map(Number);
  const [viewYear, setViewYear] = useState(year);
  const [viewMonth, setViewMonth] = useState(month - 1); // 0-based

  const days = getMonthDays(viewYear, viewMonth);

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const goNext = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleDayClick = (day: number | null) => {
    if (day === null) return;
    const mm = String(viewMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onSelectDate(`${viewYear}-${mm}-${dd}`);
  };

  return (
    <div className="bg-bg-base rounded-lg border border-border">
      {/* 月份标题 + 切换 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button onClick={goPrev} className="p-1 text-text-secondary hover:text-primary">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-bold text-primary">
          {viewYear}年{viewMonth + 1}月
        </span>
        <button onClick={goNext} className="p-1 text-text-secondary hover:text-primary">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 星期行 */}
      <div className="grid grid-cols-7 px-2 pt-3 pb-1">
        {WEEKDAY_CN.map((w) => (
          <div key={w} className="text-center text-xs text-text-secondary font-medium">
            {w}
          </div>
        ))}
      </div>

      {/* 日期格子 */}
      <div className="grid grid-cols-7 px-2 pb-3">
        {days.map((d, i) => {
          const dateStr = d !== null
            ? `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
            : null;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate && d !== null;

          return (
            <div key={i} className="aspect-square flex items-center justify-center">
              {d !== null ? (
                <button
                  onClick={() => handleDayClick(d)}
                  className={`w-8 h-8 flex items-center justify-center rounded-full text-sm transition-colors
                    ${isToday && isSelected
                      ? "bg-primary text-white ring-2 ring-primary/30"
                      : isToday
                        ? "bg-primary text-white"
                        : isSelected
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-text-base hover:bg-bg-layout"
                    }`}
                >
                  {d}
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 代办任务组件 ──

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

function TodoPanel({ selectedDate }: { selectedDate: string }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
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

  const dateObj = new Date(selectedDate + "T00:00:00");
  const dateLabel = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;

  return (
    <div className="bg-bg-base rounded-lg border border-border h-full flex flex-col">
      {/* 标题行 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-bold text-primary">
          {dateLabel} 的任务
        </span>
        <span className="text-xs text-text-secondary">
          {tasks.filter((t) => t.completed).length}/{tasks.length} 完成
        </span>
      </div>

      {/* 添加任务 */}
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

      {/* 任务卡片列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <p className="text-sm text-text-secondary">加载中...</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-text-secondary text-center mt-8">暂无任务</p>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => {
              const pct = task.completed ? 100 : 0;
              return (
                <div
                  key={task.id}
                  className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow"
                >
                  {/* 标题行 */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => handleToggle(task)}
                        className="w-4 h-4 mt-0.5 rounded border-border accent-primary cursor-pointer shrink-0"
                      />
                      <span
                        className={`text-sm font-medium truncate ${
                          task.completed ? "line-through text-text-secondary" : "text-text-base"
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="text-xs text-red-400 opacity-0 hover:opacity-100 transition-opacity shrink-0"
                    >
                      删除
                    </button>
                  </div>

                  {/* 描述 */}
                  {task.description && (
                    <p className="text-xs text-text-secondary ml-6 mb-2 line-clamp-1">
                      {task.description}
                    </p>
                  )}

                  {/* 创建时间 */}
                  <p className="text-xs text-text-secondary ml-6 mb-2">
                    {new Date(task.created_at).toLocaleString("zh-CN")}
                  </p>

                  {/* 进度条 */}
                  <div className="ml-6">
                    <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                      <span>进度</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="w-full bg-bg-layout rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );

  return (
    <div className="space-y-4">
      <NoticeSection />
      <div className="flex gap-4 items-stretch">
        {/* 左侧 1/3：月历 */}
        <div className="w-1/3">
          <Calendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        </div>
        {/* 右侧 2/3：当日任务列表 */}
        <div className="w-2/3">
          <TodoPanel selectedDate={selectedDate} />
        </div>
      </div>
    </div>
  );
}