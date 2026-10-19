import type { ReactNode } from "react";

/**
 * kami 下划线 Tab（仿招聘系统抽屉/详情页 tab 口径）：
 * 容器底边一条 1px 灰线，激活项 2px 主色下划线压线。右侧可挂动作区（如保存按钮组）。
 */
export default function TabBar({
  items,
  active,
  onChange,
  extra,
}: {
  items: { key: string; label: ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  /** Tab 行右端的动作插槽 */
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div style={{ display: "flex", gap: 20, minWidth: 0 }}>
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onChange(it.key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: `2px solid ${isActive ? "var(--color-primary)" : "transparent"}`,
                marginBottom: -1,
                padding: "8px 2px",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                color: isActive ? "var(--color-primary)" : "var(--color-text-secondary)",
                fontWeight: isActive ? 500 : 400,
                transition: "color 160ms ease, border-color 160ms ease",
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      {extra && <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4 }}>{extra}</div>}
    </div>
  );
}
