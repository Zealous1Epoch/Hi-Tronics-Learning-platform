import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/**
 * kami 页面头：标题（左，金楷）+ 操作按钮组（右）。
 * 与 Misc.PageHeader 并存：本页头支持「返回」语义（编辑页返回按钮 + dirty 确认由调用方实现）。
 */
export default function PageHead({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** 传入后标题左侧渲染返回按钮；返回行为由调用方决定（可能带 dirty 确认） */
  back?: { label?: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {back && (
          <button
            className="k-btn k-btn-ghost k-btn-sm"
            onClick={back.onClick}
            style={{ paddingLeft: 6, paddingRight: 8 }}
          >
            <ChevronLeft size={15} />
            {back.label ?? "返回"}
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <h2
            className="k-title"
            style={{ fontSize: 19, color: "var(--color-primary)", margin: 0, whiteSpace: "nowrap" }}
          >
            {title}
          </h2>
          {description && (
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "2px 0 0" }}>
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
