/** 日期 / 日期时间输入（原生控件包装）
 *
 * 空态全程不显示原生 "yyyy/mm/日" 水印（配合 index.css 的 input.k-date-empty），
 * 改为克制的中文占位文案；点击聚焦也不再冒出分段水印，只有真正按下键盘
 * 开始逐段录入时才恢复分段可见（否则输入过程是隐形的）。
 * 原生 ✕ 清空回到空态后重新隐藏。所有日期输入统一走这两个组件。
 */
import { useState, type ReactNode } from "react";

interface BaseProps {
  value: string;
  onChange: (v: string) => void;
  /** 空态中文占位；传 null 则不渲染占位层（仅隐藏原生水印） */
  placeholder?: ReactNode;
  min?: string;
  max?: string;
  className?: string;
}

function EmptyDateTimeInput({
  type, value, onChange, placeholder = "选择日期", min, max, className = "k-input",
}: BaseProps & { type: "date" | "datetime-local" }) {
  // 空态下按过键 = 正在分段录入，水印必须可见；失焦/清空后复位
  const [typing, setTyping] = useState(false);
  const empty = !value;
  const hideNative = empty && !typing;
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        onChange={e => {
          onChange(e.target.value);
          if (!e.target.value) setTyping(false);
        }}
        onKeyDown={() => { if (empty) setTyping(true); }}
        onWheel={() => { if (empty) setTyping(true); }}
        onBlur={() => setTyping(false)}
        className={`${className}${hideNative ? " k-date-empty" : ""}`}
      />
      {empty && hideNative && placeholder != null && (
        <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-[13px] text-text-muted pointer-events-none">
          {placeholder}
        </span>
      )}
    </div>
  );
}

export default function DateField(props: BaseProps) {
  return <EmptyDateTimeInput type="date" {...props} />;
}

export function DateTimeField(props: BaseProps) {
  return <EmptyDateTimeInput type="datetime-local" {...props} />;
}
