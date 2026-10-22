import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { api } from "../../lib/api";

interface LogItem {
  id: string;
  operator: string;
  category: string;
  action: string;
  resource_type: string;
  resource_name: string | null;
  description: string;
  level: string;
  created_at: string;
}

interface LogResponse {
  items: LogItem[];
  total: number;
  page: number;
  page_size: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  user: "用户管理",
  exam: "考试管理",
  paper: "试卷管理",
  question: "试题管理",
  course: "课程管理",
  knowledge: "知识管理",
  system: "系统登录",
};

const CATEGORY_ORDER = ["user", "exam", "paper", "question", "course", "knowledge", "system"];

const LEVEL_LABELS: Record<string, string> = {
  info: "一般",
  warning: "警告",
  error: "错误",
};

const LEVEL_COLORS: Record<string, string> = {
  info: "k-tag",
  warning: "k-tag k-tag-warning",
  error: "k-tag k-tag-danger",
};


export default function LogViewer() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);

  const fetchCategories = async () => {
    try {
      const data = await api<{ category: string; count: number }[]>("/admin/system-logs/categories");
      setCategories(data);
    } catch {
      // 静默失败
    }
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter) params.set("category", categoryFilter);
    if (levelFilter) params.set("level", levelFilter);
    if (search) params.set("search", search);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    try {
      const data = await api<LogResponse>(`/admin/system-logs?${params}`);
      setLogs(data.items);
      setTotal(data.total);
    } catch {
      setLogs([]);
      setTotal(0);
    }
    setLoading(false);
  }, [categoryFilter, levelFilter, search, page, pageSize]);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, levelFilter, search]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <h2 className="k-title text-[22px] text-primary mb-4">系统日志</h2>

      {/* 筛选栏 */}
      <div className="k-filter-bar mb-4">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="k-ctl"
        >
          <option value="">全部分类</option>
          {CATEGORY_ORDER.filter((c) => categories.find((cat) => cat.category === c)).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c] || c} ({categories.find((cat) => cat.category === c)?.count || 0})
            </option>
          ))}
        </select>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="k-ctl"
        >
          <option value="">全部级别</option>
          {Object.entries(LEVEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div className="k-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索操作人/描述/资源..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="k-spacer" />
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="k-btn k-btn-default k-btn-sm"
        >
          刷新
        </button>
      </div>

      {/* 日志列表 */}
      {loading ? (
        <p className="k-empty">加载中...</p>
      ) : logs.length === 0 ? (
        <div className="k-card k-empty">
          暂无操作日志
        </div>
      ) : (
        <div className="k-table-wrap overflow-hidden">
          <table className="k-table table-fixed">
            <thead>
              <tr>
                <th className="text-center w-40">时间</th>
                <th className="text-center w-32">操作人</th>
                <th className="text-center w-24">分类</th>
                <th className="text-center w-16">级别</th>
                <th>操作描述</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="text-center k-muted">
                    {new Date(log.created_at).toLocaleString("zh-CN", {
                      month: "2-digit", day: "2-digit",
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                    })}
                  </td>
                  <td className="k-strong text-center whitespace-nowrap">{log.operator}</td>
                  <td className="text-center">
                    <span className="k-tag k-tag-primary">
                      {CATEGORY_LABELS[log.category] || log.category}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={LEVEL_COLORS[log.level] || LEVEL_COLORS.info}>
                      {LEVEL_LABELS[log.level] || log.level}
                    </span>
                  </td>
                  <td className="truncate k-muted">{log.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-meta">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="k-btn k-btn-default k-btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="px-2">{page}/{totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="k-btn k-btn-default k-btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}