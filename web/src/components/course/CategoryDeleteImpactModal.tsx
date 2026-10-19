/** 删除分类影响确认弹窗（课程管理重构 S4，迁自 CourseManage :1782-1869）
 *
 * 纯展示 + 确认：影响数据（getCategoryImpact）由父组件传入，
 * 删除调用/成功提示/刷新均由父组件在 onConfirm 里处理。
 */
import { X } from "lucide-react";
import type { CategoryImpact } from "../../lib/courseApi";

interface CategoryDeleteImpactModalProps {
  impact: CategoryImpact;
  /** 删除请求进行中 */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function CategoryDeleteImpactModal({ impact, busy, onCancel, onConfirm }: CategoryDeleteImpactModalProps) {
  return (
    <div className="k-overlay" onClick={onCancel}>
      <div className="k-modal w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="k-title" style={{ fontSize: 15 }}>确认删除分类</h3>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-base"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <p className="text-sm">
            将删除分类 <span className="font-bold text-primary">「{impact.name}」</span>
            {impact.child_count > 0 && (
              <span> 及其 <span className="font-bold">{impact.child_count}</span> 个子分类</span>
            )}
          </p>

          {(impact.courses > 0 || impact.papers > 0 || impact.questions > 0) && (
            <div className="bg-bg-layout rounded-lg p-3 space-y-1.5">
              <p className="text-xs text-text-secondary">影响内容：</p>
              {impact.questions > 0 && (
                <p className="text-sm text-red-600">
                  {impact.questions} 道试题将被<span className="font-bold">永久删除</span>
                </p>
              )}
              {impact.courses > 0 && (
                <p className="text-sm text-text-secondary">{impact.courses} 门课程将归为「未分类」</p>
              )}
              {impact.papers > 0 && (
                <p className="text-sm text-text-secondary">{impact.papers} 张试卷将归为「未分类」</p>
              )}
            </div>
          )}

          {impact.details.length > 1 && (
            <div className="max-h-52 overflow-y-auto k-scroll border border-border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-bg-layout border-b border-border sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-text-secondary font-medium">分类</th>
                    <th className="text-center px-2 py-1.5 text-text-secondary font-medium">课程</th>
                    <th className="text-center px-2 py-1.5 text-text-secondary font-medium">试卷</th>
                    <th className="text-center px-2 py-1.5 text-text-secondary font-medium">试题</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.details.map((d, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-1" style={{ paddingLeft: `${12 + d.depth * 14}px` }}>{d.name}</td>
                      <td className="text-center px-2 py-1">{d.courses || "-"}</td>
                      <td className="text-center px-2 py-1">{d.papers || "-"}</td>
                      <td className="text-center px-2 py-1">{d.questions || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-5 pt-4 border-t border-border">
          <button onClick={onCancel} className="k-btn k-btn-default">取消</button>
          <button onClick={onConfirm} disabled={busy} className="k-btn k-btn-danger">
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
