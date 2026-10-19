import type { ReactNode } from "react";

export type TagTone = "default" | "primary" | "success" | "warning" | "danger";

/**
 * 枚举 → 色调/文案 的集中映射表。
 * 全站同一状态只允许一种颜色——新增状态请在此登记，禁止页面级 if-else 配色。
 */
const STATUS_MAP: Record<string, { label: string; tone: TagTone }> = {
  // 课程状态
  draft: { label: "草稿", tone: "default" },
  published: { label: "已发布", tone: "success" },
  // 账号状态（用户管理已在用同口径）
  active: { label: "正常", tone: "success" },
  disabled: { label: "已禁用", tone: "danger" },
};

/**
 * kami 状态徽章：前导圆点 + 同色系浅底。
 * 传 onClick 时呈可点开关形态（如 草稿→发布），键盘可达（原生 button）。
 */
export default function StatusTag({
  value,
  label,
  tone,
  onClick,
  title,
  disabled,
}: {
  /** STATUS_MAP 的枚举 key */
  value: string;
  /** 覆盖映射表文案 */
  label?: ReactNode;
  /** 覆盖映射表色调 */
  tone?: TagTone;
  /** 提供后 Tag 本身即开关按钮 */
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  const mapped = STATUS_MAP[value];
  const text = label ?? mapped?.label ?? value;
  const t: TagTone = tone ?? mapped?.tone ?? "default";
  const cls = `k-tag${t === "default" ? "" : ` k-tag-${t}`}`;
  const dot = (
    <span
      style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", flexShrink: 0 }}
    />
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onClick}
        title={title}
        disabled={disabled}
        style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, padding: "1px 7px" }}
      >
        {dot}
        {text}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {dot}
      {text}
    </span>
  );
}
