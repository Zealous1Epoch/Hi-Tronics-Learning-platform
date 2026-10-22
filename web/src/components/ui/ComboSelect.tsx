import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export interface ComboOption {
  value: string;
  label: string;
}

interface Props {
  /** "" 表示未选（对应 options 里的"全部"项或无） */
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  /** 收起且未选中时输入的占位文案 */
  placeholder: string;
  /** 宽度类，如 "w-32"；组件恒为 shrink-0 */
  className?: string;
}

/** 可输入过滤 + 下拉选择的单选控件（对齐招聘系统 n-select filterable clearable 形态） */
export default function ComboSelect({ value, onChange, options, placeholder, className = "w-32" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value !== "" && o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const keyword = q.trim().toLowerCase();
  const filtered = keyword ? options.filter((o) => o.value !== "" && o.label.toLowerCase().includes(keyword)) : options;

  const pick = (v: string) => {
    onChange(v);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <div
        className={`k-ctl w-full flex items-center gap-1 cursor-pointer ${open ? "!border-primary !bg-bg-card shadow-[0_0_0_3px_rgba(27,54,93,0.08)]" : ""}`}
        onClick={() => {
          if (!open) {
            setOpen(true);
            setQ("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
      >
        <input
          ref={inputRef}
          className="flex-1 min-w-0 w-full bg-transparent border-0 outline-none p-0 m-0 text-[13px] text-text-base placeholder:text-text-muted placeholder:opacity-100 cursor-pointer"
          placeholder={open ? "输入以过滤..." : placeholder}
          value={open ? q : selected ? selected.label : ""}
          onChange={(e) => {
            if (open) setQ(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
            if (e.key === "Enter" && open && filtered.length > 0) pick(filtered[0].value);
          }}
        />
        {!open && selected && (
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
        <div className="absolute left-0 top-full mt-1 z-30 w-full min-w-40 k-card py-1 max-h-60 overflow-y-auto k-scroll shadow-[0_8px_24px_rgba(20,20,19,0.1)]">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">无匹配项</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o.value || "__all"}
                onClick={() => pick(o.value)}
                className={`px-3 py-1.5 text-[13px] cursor-pointer hover:bg-bg-layout ${o.value === value ? "text-primary font-medium bg-primary/5" : "text-text-base"}`}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
