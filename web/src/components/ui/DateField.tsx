/** 日期输入：空态不显示原生 "yyyy/mm/日" 水印，改为克制的中文占位文案
 * （配合 index.css 的 input.k-date-empty 规则；聚焦后原生分段编辑恢复可见）
 */
interface DateFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
}

export default function DateField({ value, onChange, placeholder = "选择日期", min, max }: DateFieldProps) {
  return (
    <div className="relative">
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        className={`k-input${value ? "" : " k-date-empty"}`}
      />
      {!value && (
        <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-[13px] text-text-muted pointer-events-none">
          {placeholder}
        </span>
      )}
    </div>
  );
}
