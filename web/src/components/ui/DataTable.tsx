import { useMemo, type ReactNode } from "react";
import { Download } from "lucide-react";
import { EmptyState, SkeletonRows } from "./Misc";

export interface Column<T> {
  key: string;
  title: ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
  render?: (row: T, index: number) => ReactNode;
  /** 导出 CSV 时使用的纯文本，默认取 row[key] */
  text?: (row: T) => string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: string;
  compact?: boolean;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  toolbar?: ReactNode;
  actions?: ReactNode;
  exportName?: string;
  onRowClick?: (row: T) => void;
}

function toCsvValue(v: string) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty = "暂无数据",
  compact = false,
  selectable = false,
  selected = [],
  onSelectedChange,
  toolbar,
  actions,
  exportName,
  onRowClick,
}: DataTableProps<T>) {
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const allChecked = keys.length > 0 && keys.every((k) => selected.includes(k));
  const someChecked = !allChecked && keys.some((k) => selected.includes(k));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allChecked ? [] : keys);
  };
  const toggleOne = (key: string) => {
    if (!onSelectedChange) return;
    onSelectedChange(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    );
  };

  const handleExport = () => {
    const header = columns.map((c) => (typeof c.title === "string" ? c.title : c.key));
    const body = rows.map((row) =>
      columns
        .map((c) => (c.text ? c.text(row) : String((row as Record<string, unknown>)[c.key] ?? "")))
        .map(toCsvValue)
        .join(",")
    );
    const csv = "﻿" + [header.map(toCsvValue).join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="k-table-wrap">
      {(toolbar || actions || exportName) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            borderBottom: "1px solid var(--color-border)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {toolbar}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {actions}
            {exportName && (
              <button className="k-btn k-btn-default k-btn-sm" onClick={handleExport}>
                <Download size={13} /> 导出 CSV
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16 }}>
          <SkeletonRows rows={5} cols={Math.max(3, columns.length)} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState text={empty} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className={`k-table ${compact ? "k-table-compact" : ""}`}>
            <thead>
              <tr>
                {selectable && (
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={toggleAll}
                      aria-label="全选"
                    />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "left" }}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const key = rowKey(row);
                const checked = selected.includes(key);
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={{
                      cursor: onRowClick ? "pointer" : undefined,
                      background: checked ? "rgba(27,54,93,0.03)" : undefined,
                    }}
                  >
                    {selectable && (
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(key)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="选择行"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                        {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}