import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, Download } from "lucide-react";

const BASE = "/api";

async function fetchLogs(): Promise<string> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE}/admin/logs?lines=200`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("加载失败");
  return res.text();
}

export default function LogViewer() {
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      setLogs(await fetchLogs());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, 10000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-primary">系统日志</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            自动刷新
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-layout"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
          <button
            onClick={async () => {
              const token = localStorage.getItem("token");
              const res = await fetch(`${BASE}/admin/logs/download`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "app.log";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-layout"
          >
            <Download size={14} />
            下载
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-500 text-sm mb-3">{error}</p>
      )}

      <div className="bg-bg-base rounded-lg border border-border p-4 max-h-[calc(100vh-220px)] overflow-auto">
        {loading ? (
          <p className="text-text-secondary text-sm">加载中...</p>
        ) : logs ? (
          <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono leading-relaxed">{logs}</pre>
        ) : (
          <p className="text-text-secondary text-sm">暂无日志</p>
        )}
      </div>

      <p className="mt-2 text-xs text-text-secondary">
        日志文件: server/logs/app.log，自动轮转保留最近 5 个文件（每个最大 10MB）
      </p>
    </div>
  );
}