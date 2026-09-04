import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { api } from "../lib/api";

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

export default function NoticeBell() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);
  const mountedRef = useRef(true);
  const popupRef = useRef<HTMLDivElement>(null);

  const unreadCount = notices.filter((n) => !n.is_read).length;

  const fetchData = () => {
    api<NoticeListResponse>("/notices/published")
      .then((data) => {
        if (mountedRef.current) setNotices(data.notices);
      })
      .catch(() => {});
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, []);

  // 点击外部关闭弹窗
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

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

  return (
    <div className="relative" ref={popupRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1 text-white/80 hover:text-white transition-colors"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-xl border border-border z-50">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-bold text-primary">系统公告</span>
          </div>

          <div className="max-h-72 overflow-y-auto flex flex-col gap-2 p-3">
            {notices.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-4">暂无公告</p>
            ) : (
              notices.map((n) => (
                <div
                  key={n.id}
                  className="border border-border rounded-lg p-3 flex items-center justify-between gap-3 hover:shadow-sm transition-shadow cursor-pointer"
                  onClick={() => handleRead(n)}
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
                </div>
              ))
            )}
          </div>

          {/* 详情弹窗 */}
          {selectedNotice && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
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
      )}
    </div>
  );
}