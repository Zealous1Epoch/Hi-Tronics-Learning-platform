/** 课程分类下拉（课程管理重构 S4，迁自 CourseManage 编辑弹窗 :1158-1222）
 *
 * 与旧实现的两点差异（均为已确认的设计决策）：
 * - 编辑态解锁：不再只读回显，任何时候都可改分类（决策⑤：分类入口统一到本组件）
 * - value 用 ""（空串）表示「未分类」，避免 undefined 与 null 混用
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getCategoryPath, type TreeNode, type FlatCategory } from "../CourseTree";

interface CategorySelectProps {
  tree: TreeNode[];
  flatCategories: FlatCategory[];
  /** 当前分类 ID；"" = 未分类 */
  value: string;
  onChange: (categoryId: string) => void;
  placeholder?: string;
}

export default function CategorySelect({
  tree,
  flatCategories,
  value,
  onChange,
  placeholder = "请选择分类",
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const term = search.toLowerCase();

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="k-input flex items-center justify-between cursor-pointer"
      >
        <span className={value ? "text-text-base truncate" : "text-text-secondary truncate"}>
          {value ? getCategoryPath(value, flatCategories) : placeholder}
        </span>
        <ChevronDown size={14} className={`text-text-secondary shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-base border border-border rounded-md shadow-lg z-10 p-2 space-y-2">
          <input
            type="text" placeholder="搜索分类..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm" autoFocus
          />
          <div className="flex gap-2">
            <div className="flex-1 border border-border rounded-md max-h-40 overflow-y-auto">
              <div
                onClick={() => { onChange(""); setOpen(false); }}
                className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-layout ${value === "" ? "bg-primary/10 text-primary font-medium" : ""}`}
              >未分类</div>
              {tree
                .filter(n => !n.parent_id && (!term || n.name.toLowerCase().includes(term)))
                .map(root => (
                  <div key={root.id}
                    onClick={() => { onChange(root.id); if (root.children.length === 0) setOpen(false); }}
                    className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-layout flex items-center justify-between ${value === root.id ? "bg-primary/10 text-primary font-medium" : ""}`}
                  >
                    <span className="truncate">{root.name}</span>
                    {root.children.length > 0 && <ChevronRight size={12} className="text-text-secondary shrink-0 ml-1" />}
                  </div>
                ))}
            </div>
            {value && (() => {
              const selectedRoot = tree.find(n => n.id === value);
              if (!selectedRoot || selectedRoot.children.length === 0) return null;
              const filteredChildren = term
                ? selectedRoot.children.filter(c => c.name.toLowerCase().includes(term))
                : selectedRoot.children;
              return (
                <div className="flex-1 border border-border rounded-md max-h-40 overflow-y-auto">
                  {filteredChildren.map(child => (
                    <div key={child.id}
                      onClick={() => { onChange(child.id); setOpen(false); }}
                      className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-layout truncate ${value === child.id ? "bg-primary/10 text-primary font-medium" : ""}`}
                    >{child.name}</div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
