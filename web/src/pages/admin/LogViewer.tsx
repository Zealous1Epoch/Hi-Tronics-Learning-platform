import { useState, useEffect, useCallback } from "react";
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
  info: "bg-blue-50 text-blue-700 border-blue-200",
  warning: "bg-yellow-50 text-yellow-700 border-yellow-200",
  error: "bg-red-50 text-red-700 border-red-200",
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
      <h2 className="text-xl font-bold text-primary mb-4">系统日志</h2>

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm"
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
          className="border border-border rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">全部级别</option>
          {Object.entries(LEVEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="搜索操作人/描述/资源..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm flex-1 max-w-xs"
        />
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-layout"
        >
          刷新
        </button>
      </div>

      {/* 日志列表 */}
      {loading ? (
        <p className="text-text-secondary text-sm">加载中...</p>
      ) : logs.length === 0 ? (
        <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
          暂无操作日志
        </div>
      ) : (
        <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-bg-layout border-b border-border">
              <tr>
                <th className="text-center px-3 py-3 font-medium text-text-secondary w-40">时间</th>
                <th className="text-center px-3 py-3 font-medium text-text-secondary w-20">操作人</th>
                <th className="text-center px-3 py-3 font-medium text-text-secondary w-24">分类</th>
                <th className="text-center px-2 py-3 font-medium text-text-secondary w-16">级别</th>
                <th className="text-left px-3 py-3 font-medium text-text-secondary">操作描述</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                  <td className="px-3 py-2.5 text-text-secondary text-xs text-center">
                    {new Date(log.created_at).toLocaleString("zh-CN", {
                      month: "2-digit", day: "2-digit",
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-center">{log.operator}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                      {CATEGORY_LABELS[log.category] || log.category}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${LEVEL_COLORS[log.level] || LEVEL_COLORS.info}`}>
                      {LEVEL_LABELS[log.level] || log.level}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary truncate">{log.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-secondary">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-border rounded-md hover:bg-bg-layout disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="px-2">{page}/{totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1 border border-border rounded-md hover:bg-bg-layout disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}