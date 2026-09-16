import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../lib/api";

interface Entry {
  id: string;
  group: string;
  label: string;
  sub?: string;
  to: string;
}

const GROUP_ORDER = ["课程","考试","试卷","学员"];

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const [courses, exams, papers, users] = await Promise.all([
        api<Record<string, unknown>[]>("/courses").catch(() => []),
        api<Record<string, unknown>[]>("/exams").catch(() => []),
        api<Record<string, unknown>[]>("/papers").catch(() => []),
        api<Record<string, unknown>[]>("/users?role=student&page_size=200").catch(() => []),
      ]);
      const list: Entry[] = [
        ...courses.map((c) => ({
          id: `c-${c.id}`,
          group: "课程",
          label: String(c.title ?? ""),
          sub: `状态 ${c.status ?? "-"}`,
          to: "/admin/courses",
        })),
        ...exams.map((e) => ({
          id: `e-${e.id}`,
          group: "考试",
          label: String(e.title ?? ""),
          sub: `状态 ${e.status ?? "-"}`,
          to: "/admin/exams",
        })),
        ...papers.map((p) => ({
          id: `p-${p.id}`,
          group: "试卷",
          label: String(p.title ?? p.name ?? ""),
          to: `/admin/papers/${p.id}`,
        })),
        ...users.map((u) => ({
          id: `u-${u.id}`,
          group: "学员",
          label: String(u.name ?? ""),
          sub: [u.employee_id, u.department].filter(Boolean).join(" ·"),
          to: "/admin/users",
        })),
      ];
      setEntries(list);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [loaded]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      void load();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, load]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? entries.filter(
          (e) =>
            e.label.toLowerCase().includes(q) || (e.sub ?? "").toLowerCase().includes(q)
        )
      : entries;
    return matched.slice(0, 40);
  }, [entries, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const go = (entry: Entry) => {
    onClose();
    navigate(entry.to);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) go(results[active]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";

  return (
    <div className="k-overlay" style={{ alignItems: "flex-start", paddingTop: "12vh" }} onClick={onClose}>
      <div
        className="k-modal"
        style={{ maxWidth: 560, padding: 0, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <Search size={15} style={{ color: "var(--color-text-muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索课程、考试、试卷、学员…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 14,
              fontFamily: "inherit",
              background: "transparent",
              color: "var(--color-text-base)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Esc 关闭</span>
        </div>

        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: "6px 0" }}>
          {!loaded && <div className="k-empty">正在加载索引…</div>}
          {loaded && results.length === 0 && <div className="k-empty">没有匹配的结果</div>}
          {results.map((entry, i) => {
            const showGroup = entry.group !== lastGroup;
            lastGroup = entry.group;
            return (
              <div key={entry.id}>
                {showGroup && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                      padding: "8px 16px 4px",
                    }}
                  >
                    {entry.group}
                  </div>
                )}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(entry)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    width: "100%",
                    padding: "7px 16px",
                    border: "none",
                    background: i === active ? "var(--color-bg-hover)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--color-text-base)" }}>{entry.label}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{entry.sub}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 注册 ⌘K / Ctrl+K 快捷键 */
export function useCommandHotkey(setOpen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v: boolean) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);
}

export { GROUP_ORDER };