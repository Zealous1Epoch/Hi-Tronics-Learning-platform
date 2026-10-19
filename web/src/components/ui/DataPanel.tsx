import type { ReactNode } from "react";
import { EmptyState, SkeletonRows } from "./Misc";

/**
 * kami 数据面板：卡片外框 + 可选头部（标题/右侧插槽）+ 内容四态（loading/empty/children）+ 底部插槽。
 * 用法提示：内嵌 DataTable 时保持默认 bodyPadding=0——DataTable 自带的 k-table-wrap 描边
 * 已被作用域样式抹平，避免双线；独立放筛选/图表等内容时传 bodyPadding。
 */
export default function DataPanel({
  title,
  extra,
  loading = false,
  empty = false,
  emptyText = "暂无数据",
  emptyHint,
  footer,
  bodyPadding,
  children,
  style,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  emptyHint?: string;
  /** 底部通栏插槽（分页条等，border-top 由本组件负责） */
  footer?: ReactNode;
  bodyPadding?: number | string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      className="k-card [&_.k-table-wrap]:border-0 [&_.k-table-wrap]:rounded-none"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", ...style }}
    >
      {(title || extra) && (
        <div className="k-card-head" style={{ flexShrink: 0 }}>
          {typeof title === "string" ? <h3 className="k-card-title">{title}</h3> : title ?? <span />}
          {extra}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: bodyPadding ?? 0 }}>
        {loading ? (
          <div style={{ padding: 16 }}>
            <SkeletonRows rows={5} cols={5} />
          </div>
        ) : empty ? (
          <EmptyState text={emptyText} hint={emptyHint} />
        ) : (
          children
        )}
      </div>
      {footer && (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--color-border)",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            fontSize: 12,
            color: "var(--color-text-secondary)",
          }}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
