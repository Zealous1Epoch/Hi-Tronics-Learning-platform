import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function Skeleton({ height = 14, width = "100%" }: { height?: number | string; width?: number | string }) {
  return <div className="k-skeleton" style={{ height, width }} />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 16 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={c === 0 ? "28%" : `${Math.round(60 / cols)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ text = "暂无数据", hint }: { text?: string; hint?: string }) {
  return (
    <div className="k-empty">
      <Inbox size={26} strokeWidth={1.5} style={{ color: "var(--color-border-dark)" }} />
      <div className="k-empty-title">{text}</div>
      {hint && <div style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
}: {
  breadcrumb?: string[];
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
        flexWrap: "wrap",
      }}
    >
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 2 }}>
            {breadcrumb.join(" / ")}
          </div>
        )}
        <h2 className="k-title" style={{ fontSize: 19, color: "var(--color-primary)", margin: 0 }}>
          {title}
        </h2>
        {description && (
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "2px 0 0" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  extra,
  children,
  bodyStyle,
  className = "",
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyStyle?: React.CSSProperties;
  className?: string;
}) {
  return (
    <section className={`k-card ${className}`}>
      {(title || extra) && (
        <div className="k-card-head">
          {typeof title === "string" ? <h3 className="k-card-title">{title}</h3> : title}
          {extra}
        </div>
      )}
      <div className="k-card-body" style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function Tag({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
}) {
  return <span className={`k-tag k-tag-${tone}`}>{children}</span>;
}