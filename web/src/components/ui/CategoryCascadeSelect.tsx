import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

interface FlatCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

interface Props {
  /** "" = 全部分类 */
  value: string;
  onChange: (v: string) => void;
  categories: FlatCategory[];
  placeholder?: string;
  className?: string;
}

/**
 * 课程分类级联选择：点击触发展开面板；
 * 面板顶部支持输入过滤（结果平铺显示完整路径），未输入时按层级分列级联浏览。
 * hover 含子级节点展开下一列，点击任意节点即选中（含容器节点）。
 */
export default function CategoryCascadeSelect({
  value,
  onChange,
  categories,
  placeholder = "课程分类",
  className = "w-44",
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  /** 展开链：当前各列展示的子级来自这些 id */
  const [path, setPath] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const byParent = useMemo(() => {
    const m = new Map<string, FlatCategory[]>();
    categories.forEach((c) => {
      const key = c.parent_id || "";
      const arr = m.get(key) || [];
      arr.push(c);
      m.set(key, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => (a.name > b.name ? 1 : -1)));
    return m;
  }, [categories]);

  const pathNames = useMemo(() => {
    if (!value) return null;
    const names: string[] = [];
    let cur = categories.find((c) => c.id === value);
    while (cur) {
      names.unshift(cur.name);
      cur = cur.parent_id ? categories.find((c) => c.id === cur!.parent_id) : undefined;
    }
    return names;
  }, [value, categories]);

  const keyword = q.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!keyword) return [];
    return categories
      .filter((c) => c.name.toLowerCase().includes(keyword))
      .map((c) => {
        const names: string[] = [];
        let cur: FlatCategory | undefined = c;
        while (cur) {
          names.unshift(cur.name);
          cur = cur.parent_id ? categories.find((x) => x.id === cur!.parent_id) : undefined;
        }
        return { id: c.id, full: names.join(" - ") };
      });
  }, [keyword, categories]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setQ("");
    setPath([]);
    setOpen(false);
  };

  // 级联列：第 0 列根节点，其后每列对应 path 中展开的节点子级
  const columns: FlatCategory[][] = [[]];
  path.forEach((id) => {
    const kids = byParent.get(id) || [];
    if (kids.length) columns.push(kids);
  });

  const rowCls = (active: boolean) =>
    `flex items-center gap-1 px-3 py-1.5 text-[13px] cursor-pointer hover:bg-bg-layout ${
      active ? "bg-accent-fill text-primary font-medium" : "text-text-base"
    }`;

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <div
        className={`k-ctl w-full flex items-center gap-1 cursor-pointer ${open ? "!border-primary !bg-bg-card shadow-[0_0_0_3px_rgba(27,54,93,0.08)]" : ""}`}
        onClick={() => {
          if (!open) {
            setOpen(true);
            setQ("");
            // 打开时定位到已选节点所在链
            if (pathNames && value) {
              const chain: string[] = [];
              let cur = categories.find((c) => c.id === value);
              while (cur?.parent_id) {
                chain.unshift(cur.id);
                cur = categories.find((c) => c.id === cur!.parent_id);
              }
              setPath(chain);
            } else {
              setPath([]);
            }
          }
        }}
      >
        <input
          className="flex-1 min-w-0 w-full bg-transparent border-0 outline-none p-0 m-0 text-[13px] text-text-base placeholder:text-text-muted cursor-pointer"
          placeholder={placeholder}
          value={pathNames ? pathNames.join(" - ") : ""}
          readOnly
          title={pathNames ? pathNames.join(" - ") : undefined}
        />
        {pathNames && !open && (
          <button
            type="button"
            title="清除"
            className="text-text-muted hover:text-text-base shrink-0 inline-flex cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              pick("");
            }}
          >
            <X size={12} />
          </button>
        )}
        <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 k-card shadow-[0_8px_24px_rgba(20,20,19,0.1)] w-[420px] max-w-[90vw]">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              className="k-ctl w-full"
              placeholder="搜索分类名..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && matched.length > 0) pick(matched[0].id);
              }}
            />
          </div>
          {keyword ? (
            <div className="max-h-60 overflow-y-auto k-scroll py-1">
              {matched.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">无匹配分类</div>
              ) : (
                matched.map((m) => (
                  <div key={m.id} className={rowCls(m.id === value)} onClick={() => pick(m.id)}>
                    {m.full}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex max-h-60 overflow-x-auto">
              <div className="w-[140px] shrink-0 border-r border-border py-1 max-h-60 overflow-y-auto k-scroll">
                <div className={rowCls(value === "")} onClick={() => pick("")}>
                  全部课程分类
                </div>
                {(byParent.get("") || []).map((node) => (
                  <div
                    key={node.id}
                    className={rowCls(node.id === value)}
                    onMouseEnter={() => setPath((p) => p.slice(0, 0).concat(node.id))}
                    onClick={() => pick(node.id)}
                  >
                    <span className="truncate flex-1">{node.name}</span>
                    {(byParent.get(node.id) || []).length > 0 && <ChevronRight size={12} className="text-text-muted shrink-0" />}
                  </div>
                ))}
              </div>
              {columns.slice(1).map((col, ci) => (
                <div key={ci} className="w-[140px] shrink-0 border-r border-border last:border-r-0 py-1 max-h-60 overflow-y-auto k-scroll">
                  {col.map((node) => (
                    <div
                      key={node.id}
                      className={rowCls(node.id === value)}
                      onMouseEnter={() => setPath((p) => p.slice(0, ci + 1).concat(node.id))}
                      onClick={() => pick(node.id)}
                    >
                      <span className="truncate flex-1">{node.name}</span>
                      {(byParent.get(node.id) || []).length > 0 && <ChevronRight size={12} className="text-text-muted shrink-0" />}
                    </div>
                  ))}
                </div>
              ))}
              {/* 叶子链的末列若节点无子级，上面 columns 只会少一列——点击即选，无需空列 */}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
