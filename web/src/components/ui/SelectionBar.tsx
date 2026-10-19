import type { ReactNode } from "react";

/**
 * kami 批量操作条：选中数 >0 时出现在表格上方的浅蓝横条（招聘系统 selection-bar 口径）。
 * 本期课程列表暂无批量动作，先落地组件，children 放批量按钮组。
 */
export default function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear?: () => void;
  children?: ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "7px 14px",
        background: "rgba(27, 54, 93, 0.05)",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--color-primary)", fontWeight: 500 }}>已选 {count} 项</span>
      {children}
      {onClear && (
        <button className="k-link" onClick={onClear} style={{ marginLeft: "auto" }}>
          清空选择
        </button>
      )}
    </div>
  );
}
